-- =====================================================================
-- CONTAS A RECEBER PREVISTO — o que ainda não virou nota fiscal
--
-- Filipe, 13/08: "a minha concepção de contas a receber é exatamente aquele
-- faturamento que aparece que é fixo (mensalidade de processo, mensalidade,
-- pro labore, projeto com parcela) e as horas que vão acontecendo no mês. A
-- ideia é que ele me informe no mês as notas fiscais liberadas e também
-- aquelas ainda não liberadas pra ter uma gama maior... no fim do dia,
-- estamos fazendo tudo isso no erp pra ter essa gestão de fluxo de caixa
-- antecipada e em tempo real".
--
-- E em 14/08, fechando as regras:
--   * horas: "projeta apenas o lançado naquele mês" — nada de média;
--   * "as horas trabalhadas em agosto devem ser refletidas sempre em setembro
--     (mês subsequente)";
--   * "podemos considerar o previsto das horas trabalhadas até o momento para
--     setembro já como previsão" — ou seja, o número de setembro cresce
--     enquanto agosto corre, não espera o mês fechar;
--   * "Pode lançar para vencimento do dia 15 sempre do mês seguinte".
--
-- POR QUE ISTO É UMA CONSULTA E NÃO LANÇAMENTOS GRAVADOS:
-- o previsto muda toda vez que alguém lança hora. Se cada lançamento de
-- timesheet tivesse que criar/atualizar/apagar uma linha em
-- finance.lancamentos, bastaria uma falha no meio para o caixa passar a mentir
-- — e o razão ficaria cheio de recebíveis que nunca existiram. Calculado na
-- leitura, o número está sempre certo por construção e não suja nada.
--
-- O QUE ESTA VERSÃO NÃO COBRE, de propósito:
--   * êxito (3 casos ativos): o valor depende do desfecho do processo. Chutar
--     um número aqui seria pior do que não mostrar nada.
--   * reajuste em cima do valor fixo: usa o valor vigente hoje.
-- =====================================================================

-- Dia do mês em que o previsto cai. Constante e não configuração porque o
-- Filipe deu a regra fechada ("dia 15 sempre do mês seguinte"). Se um dia
-- virar decisão por cliente, vira coluna — hoje seria inventar necessidade.
CREATE OR REPLACE FUNCTION public.cp_receita_prevista(p_user_id uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'config', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_mes_inicio date;
  v_mes_fim date;
  v_comp_inicio date;   -- primeiro dia do mês de COMPETÊNCIA (o mês anterior)
  v_comp_fim date;
  v_data_prevista date; -- dia 15 do mês exibido
  v_salario numeric(14,2);
  v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  v_mes_inicio := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_mes_fim := (v_mes_inicio + interval '1 month - 1 day')::date;
  v_comp_inicio := (v_mes_inicio - interval '1 month')::date;
  v_comp_fim := (v_mes_inicio - interval '1 day')::date;
  v_data_prevista := v_mes_inicio + 14;

  -- Salário mínimo vigente na competência, não o de hoje: uma previsão de
  -- março tem de usar o salário de março.
  SELECT sm.valor INTO v_salario
  FROM config.salario_minimo sm
  WHERE sm.tenant_id = v_tenant AND sm.vigencia_desde <= v_comp_fim
  ORDER BY sm.vigencia_desde DESC
  LIMIT 1;

  WITH regras AS (
    SELECT
      c.id AS caso_id,
      c.numero AS caso_numero,
      c.nome AS caso_nome,
      COALESCE(NULLIF(r.item->>'regra_cobranca', ''), c.regra_cobranca) AS regra,
      COALESCE(r.item->'regra_cobranca_config', c.regra_cobranca_config, '{}'::jsonb) AS cfg,
      -- Rateio entre pagadores. Sem rateio configurado, quem paga é o cliente
      -- do contrato, 100%. Sem esse fallback o caso simplesmente sumiria da
      -- previsão — e some justamente o caso mais comum, o de um pagador só.
      CASE
        WHEN jsonb_typeof(r.item->'pagadores_servico') = 'array'
             AND jsonb_array_length(r.item->'pagadores_servico') > 0
          THEN r.item->'pagadores_servico'
        WHEN jsonb_typeof(c.pagadores_servico) = 'array'
             AND jsonb_array_length(c.pagadores_servico) > 0
          THEN c.pagadores_servico
        ELSE jsonb_build_array(jsonb_build_object('cliente_id', ct.cliente_id, 'percentual', 100))
      END AS pagadores,
      NULLIF(r.item->>'inicio_vigencia', '')::date AS inicio_vigencia
    FROM contracts.casos c
    JOIN contracts.contratos ct ON ct.id = c.contrato_id
    LEFT JOIN LATERAL (
      SELECT x AS item
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.regras_financeiras) = 'array' THEN c.regras_financeiras ELSE '[]'::jsonb END
      ) x
      WHERE COALESCE(NULLIF(x->>'status', ''), 'ativo') = 'ativo'
    ) r ON true
    WHERE c.tenant_id = v_tenant AND c.ativo AND c.status = 'ativo'
  ),

  -- 1. HORAS lançadas no mês de competência.
  -- O valor da hora sai de resolver_valor_hora — o mesmo ponto que o
  -- faturamento usa. Reimplementar a tabela de preço por cargo aqui seria
  -- repetir exatamente o bug de julho, em que a tela mostrava um valor e a
  -- fatura cobrava outro.
  horas_cargo AS (
    SELECT t.caso_id, t.cargo_id,
           SUM(COALESCE(t.horas_aprovadas, t.horas_revisadas, t.horas)) AS horas
    FROM operations.timesheets t
    WHERE t.tenant_id = v_tenant
      AND COALESCE(t.excluido_faturamento, false) = false
      AND t.data_lancamento BETWEEN v_comp_inicio AND v_comp_fim
      -- Hora que já entrou num lote de faturamento não é mais previsão: ou
      -- virou nota, ou está a caminho de virar. Contar duas vezes dobraria o
      -- caixa previsto.
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items bi WHERE bi.origem_id = t.id
      )
    GROUP BY 1, 2
  ),
  horas_caso AS (
    SELECT h.caso_id,
           SUM(h.horas) AS horas,
           SUM(h.horas * COALESCE(public.resolver_valor_hora(h.caso_id, h.cargo_id), 0))::numeric(14,2) AS valor
    FROM horas_cargo h
    GROUP BY 1
  ),
  itens_horas AS (
    SELECT g.caso_id, g.caso_numero, g.caso_nome, g.pagadores,
           'horas'::text AS origem,
           ('Horas de ' || to_char(v_comp_inicio, 'MM/YYYY') || ' — ' || g.caso_nome) AS descricao,
           hc.valor,
           v_data_prevista AS data_prevista,
           hc.horas
    FROM regras g
    JOIN horas_caso hc ON hc.caso_id = g.caso_id
    WHERE g.regra = 'hora' AND hc.valor > 0
  ),

  -- 2. VALORES FIXOS do mês de competência (mensalidade, pró-labore, SM).
  itens_fixos AS (
    SELECT g.caso_id, g.caso_numero, g.caso_nome, g.pagadores,
           'fixo'::text AS origem,
           (CASE g.regra
              WHEN 'mensal' THEN 'Mensalidade'
              WHEN 'mensalidade_processo' THEN 'Mensalidade de processo'
              WHEN 'mensalidade_carteira' THEN 'Mensalidade de carteira'
              WHEN 'pro_labore' THEN 'Pró-labore'
              WHEN 'salario_minimo' THEN 'Honorário em salário mínimo'
            END || ' ' || to_char(v_comp_inicio, 'MM/YYYY') || ' — ' || g.caso_nome) AS descricao,
           (CASE
              WHEN g.regra = 'salario_minimo'
                THEN NULLIF(g.cfg->>'quantidade_sm', '')::numeric * COALESCE(v_salario, 0)
              ELSE NULLIF(g.cfg->>'valor_mensal', '')::numeric
            END)::numeric(14,2) AS valor,
           v_data_prevista AS data_prevista,
           NULL::numeric AS horas
    FROM regras g
    WHERE g.regra IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'pro_labore', 'salario_minimo')
      AND (g.inicio_vigencia IS NULL OR g.inicio_vigencia <= v_comp_fim)
  ),

  -- 3. PARCELAS DE PROJETO: têm data própria, combinada em contrato. Aqui a
  -- regra do dia 15 não vale — a data já existe e é ela que manda.
  itens_parcelas AS (
    SELECT g.caso_id, g.caso_numero, g.caso_nome, g.pagadores,
           'parcela'::text AS origem,
           ('Parcela de projeto — ' || g.caso_nome) AS descricao,
           NULLIF(p->>'valor', '')::numeric(14,2) AS valor,
           NULLIF(p->>'data_pagamento', '')::date AS data_prevista,
           NULL::numeric AS horas
    FROM regras g,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(g.cfg->'parcelas') = 'array' THEN g.cfg->'parcelas' ELSE '[]'::jsonb END
         ) p
    WHERE g.regra = 'projeto'
  ),

  todos AS (
    SELECT * FROM itens_horas
    UNION ALL SELECT * FROM itens_fixos
    UNION ALL SELECT * FROM itens_parcelas
  ),

  -- Explode por pagador: um caso rateado 60/40 vira duas linhas, porque são
  -- dois recebimentos de dois clientes diferentes — e é assim que o Filipe
  -- precisa ver para cobrar.
  rateado AS (
    SELECT
      t.caso_id, t.caso_numero, t.caso_nome, t.origem, t.descricao, t.horas,
      t.data_prevista,
      NULLIF(pg->>'cliente_id', '')::uuid AS cliente_id,
      COALESCE(NULLIF(pg->>'percentual', '')::numeric, 100) AS percentual,
      (t.valor * COALESCE(NULLIF(pg->>'percentual', '')::numeric, 100) / 100)::numeric(14,2) AS valor
    FROM todos t, LATERAL jsonb_array_elements(t.pagadores) pg
    WHERE t.valor IS NOT NULL AND t.valor > 0
      AND t.data_prevista BETWEEN v_mes_inicio AND v_mes_fim
  )

  SELECT jsonb_build_object(
    'mes_inicio', v_mes_inicio,
    'mes_fim', v_mes_fim,
    'competencia', v_comp_inicio,
    'data_prevista', v_data_prevista,
    'total', COALESCE((SELECT SUM(valor) FROM rateado), 0),
    'total_horas', COALESCE((SELECT SUM(valor) FROM rateado WHERE origem = 'horas'), 0),
    'total_fixo', COALESCE((SELECT SUM(valor) FROM rateado WHERE origem = 'fixo'), 0),
    'total_parcela', COALESCE((SELECT SUM(valor) FROM rateado WHERE origem = 'parcela'), 0),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        -- id sintético e estável: a tela usa como key de lista, e ele NÃO pode
        -- colidir com um id de finance.lancamentos — isto aqui não é um
        -- lançamento e não pode ser baixado, reagendado nem arrastado.
        'id', 'previsto:' || r.origem || ':' || r.caso_id::text || ':' ||
              COALESCE(r.cliente_id::text, 'sem') || ':' || r.data_prevista::text,
        'descricao', r.descricao,
        'cliente_id', r.cliente_id,
        'cliente_nome', cl.nome,
        'caso_numero', r.caso_numero,
        'valor', r.valor,
        'vencimento', r.data_prevista,
        'status', 'previsto',
        'origem', r.origem,
        'horas', r.horas,
        'percentual', r.percentual
      ) ORDER BY r.data_prevista, cl.nome, r.descricao)
      FROM rateado r
      LEFT JOIN crm.clientes cl ON cl.id = r.cliente_id
    ), '[]'::jsonb),
    -- Por dia, para o gráfico somar sem ter que agrupar no navegador.
    'por_dia', COALESCE((
      SELECT jsonb_object_agg(d::text, v)
      FROM (SELECT data_prevista AS d, SUM(valor)::numeric(14,2) AS v FROM rateado GROUP BY 1) x
    ), '{}'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.cp_receita_prevista(uuid, date) TO authenticated, service_role;
