-- =====================================================================
-- Fila de liberação por COMPETÊNCIA (2/3 da fila dentro da revisão)
--
-- Decisão do cliente (set/2026): a etapa 1 do faturamento ("fila de
-- liberação", tela própria com get_itens_a_faturar) passa a aparecer DENTRO
-- da revisão de fatura, como etapa "Na fila", calculada AO VIVO — nada é
-- persistido; a hora continua editável até ser liberada. Aba por competência
-- (mês em que se cobra: hora de agosto = competência setembro).
--
-- get_fila_por_competencia(p_user_id, p_competencia) devolve os itens
-- VIRTUAIS do mês, no MESMO formato de chaves dos itens de get_revisao_fatura,
-- para a tela normalizar tudo com o mesmo código. Diferenças marcadas:
--   id          = 'fila:' || origem_tipo || ':' || origem_id  (texto, determinístico)
--   status      = 'na_fila'
--   billing_item_id, valores revisados/aprovados, histórico = nulos/vazios
--
-- De onde vem cada coisa:
--  (a) HORAS e REGRAS DO CASO: de public.get_itens_a_faturar, chamada para o
--      mês inteiro [1º, último dia] e ACHATADA (cliente > contrato > caso >
--      extrato). Não reescreve a conta: a regra "hora em caso mensal vale
--      zero" (03/09), os adiamentos (18/08), a carteira (25/08) e o que vier
--      depois continuam num lugar só. Se a fila e o gerador divergirem, foi
--      assim que a tela mostrou 1.827 horas e o gerador pegou 1 (31/08).
--      O teto de horas (finance.aplicar_teto_horas) NÃO é aplicado aqui — é
--      conta do período inteiro, feita ao liberar; na fila vai o valor
--      simples (horas x valor_hora_atual, ou 0 quando resolver_valor_hora
--      devolve NULL/0).
--  (b) DESPESAS em_lancamento reembolsáveis com competência no mês. Hoje a
--      tela da fila mescla isso no front via get-despesas; aqui vem do banco,
--      com a elegibilidade de start_faturamento_despesas_fallback (contrato
--      ativo, caso não inativo, sem billing_item).
--  (c) Regras que JÁ viraram billing_item na mesma competência saem da fila
--      — é assim que "Gerar faturamento do mês" limpa a etapa "Na fila".
--      get_itens_a_faturar já exclui por período EXATO; aqui a exclusão é por
--      MÊS de periodo_inicio, para cobrir uma liberação feita com janela
--      diferente. O item gerado carrega o id da REGRA (sem o sufixo do mês),
--      então o casamento é por caso + tipo de cobrança (snapshot); linha que
--      é um ADIAMENTO entrando no mês fica de fora desse casamento — é outra
--      cobrança, de outro mês, e não pode sumir porque a mensalidade deste
--      mês foi gerada.
--
-- Escopo: o MESMO de get_revisao_fatura, via finance.escopo_faturamento
-- (20260922100000). get_itens_a_faturar não filtra por centro de custo — a
-- tela antiga era só do financeiro; dentro da revisão, quem é gestor de área
-- vê a fila da área dele, como já vê os itens.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_fila_por_competencia(p_user_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_read boolean := false;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_inicio date;
  v_fim date;
  v_arvore jsonb;
BEGIN
  SELECT e.tenant_id, e.can_view_all, e.viewer_area_id
  INTO v_tenant_id, v_can_view_all, v_viewer_area_id
  FROM finance.escopo_faturamento(p_user_id) e;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Mesma lista de get_revisao_fatura: a fila vive dentro da revisão, então
  -- quem enxerga a revisão enxerga a fila.
  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read',
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_read;

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'Sem permissão para visualizar revisão de fatura';
  END IF;

  IF p_competencia IS NULL THEN
    RAISE EXCEPTION 'Informe a competência';
  END IF;

  -- Sempre o mês inteiro: o gerador compara periodo_inicio E periodo_fim para
  -- não gerar duas vezes, e "Gerar faturamento do mês" usa [1º, último dia].
  v_inicio := date_trunc('month', p_competencia)::date;
  v_fim := (v_inicio + interval '1 month' - interval '1 day')::date;

  v_arvore := public.get_itens_a_faturar(p_user_id, v_inicio, v_fim, NULL);

  RETURN (
    WITH linhas AS (
      -- Achata a árvore de get_itens_a_faturar em uma linha por item.
      SELECT
        NULLIF(cl->>'cliente_id', '')::uuid AS cliente_id,
        NULLIF(ct->>'contrato_id', '')::uuid AS contrato_id,
        NULLIF(cs->>'caso_id', '')::uuid AS caso_id,
        NULLIF(l->>'origem_id', '')::uuid AS origem_id,
        l->>'tipo' AS tipo,
        NULLIF(l->>'caso_regra', '') AS caso_regra,
        COALESCE(l->>'descricao', '') AS descricao,
        NULLIF(l->>'lancado_por', '') AS lancado_por,
        NULLIF(l->>'data_referencia', '')::date AS data_referencia,
        COALESCE(NULLIF(l->>'horas', '')::numeric, 0) AS horas,
        COALESCE(NULLIF(l->>'valor', '')::numeric, 0) AS valor
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_arvore) = 'array' THEN v_arvore ELSE '[]'::jsonb END
      ) cl
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cl->'contratos') = 'array' THEN cl->'contratos' ELSE '[]'::jsonb END
      ) ct
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ct->'casos') = 'array' THEN ct->'casos' ELSE '[]'::jsonb END
      ) cs
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cs->'extrato') = 'array' THEN cs->'extrato' ELSE '[]'::jsonb END
      ) l
      WHERE NULLIF(l->>'origem_id', '') IS NOT NULL
    ),
    despesas AS (
      -- Elegibilidade de start_faturamento_despesas_fallback, restrita ao que
      -- a tela da fila mostra hoje (status em_lancamento).
      SELECT
        COALESCE(d.cliente_id, c.cliente_id) AS cliente_id,
        c.id AS contrato_id,
        cs.id AS caso_id,
        d.id AS origem_id,
        'despesa'::text AS tipo,
        NULL::text AS caso_regra,
        ('Despesa' || CASE WHEN NULLIF(d.categoria, '') IS NOT NULL THEN ' - ' || d.categoria ELSE '' END)::text AS descricao,
        NULL::text AS lancado_por,
        d.data_lancamento::date AS data_referencia,
        0::numeric AS horas,
        COALESCE(d.valor, 0)::numeric AS valor
      FROM operations.despesas d
      JOIN contracts.contratos c
        ON c.id = d.contrato_id
       AND c.tenant_id = v_tenant_id
      JOIN contracts.casos cs
        ON cs.id = d.caso_id
       AND cs.tenant_id = v_tenant_id
      WHERE d.tenant_id = v_tenant_id
        -- Competência, não data do gasto: despesa de agosto é cobrada em
        -- setembro (Filipe, 01/09). Igual ao gerador de despesas.
        AND COALESCE(d.periodo_faturamento, d.data_lancamento::date) BETWEEN v_inicio AND v_fim
        AND d.status = 'em_lancamento'
        AND COALESCE(d.reembolsavel, true) = true
        AND c.status = 'ativo'
        AND cs.status <> 'inativo'
        AND NOT EXISTS (
          SELECT 1
          FROM finance.billing_items bi
          WHERE bi.tenant_id = v_tenant_id
            AND bi.origem_tipo = 'despesa'
            AND bi.origem_id = d.id
            AND bi.status <> 'cancelado'
        )
    ),
    itens AS (
      SELECT * FROM linhas
      UNION ALL
      SELECT * FROM despesas
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', 'fila:' || ot.origem_tipo || ':' || i.origem_id::text,
          'billing_item_id', NULL,
          'item_numero', NULL,
          'billing_batch_id', NULL,
          'batch_numero', NULL,
          'status', 'na_fila',
          'grupo_id', NULL,
          'origem_tipo', ot.origem_tipo,
          'origem_id', i.origem_id,
          -- tipo da linha como get_itens_a_faturar classifica (timesheet,
          -- despesa, mensal, mensalidade_processo, projeto, projeto_parcela,
          -- exito). Não existe na revisão; ajuda a tela a agrupar.
          'fila_tipo', i.tipo,
          'data_referencia', i.data_referencia,
          'cliente_id', cli.id,
          'cliente_nome', cli.nome,
          'contrato_id', c.id,
          'contrato_numero', c.numero,
          'contrato_nome', c.nome_contrato,
          'caso_id', cs.id,
          'caso_numero', cs.numero,
          'caso_nome', cs.nome,
          'regra_nome', i.descricao,
          'descricao', i.descricao,
          'revisores_modo', cs.timesheet_config->>'revisores_modo',
          'caso_regra_cobranca', CASE
            -- hora: já vem resolvido da fila (aba Horas só se o caso cobra por hora)
            WHEN i.tipo = 'timesheet' THEN i.caso_regra
            WHEN i.tipo = 'despesa' THEN 'despesa'
            -- regra do caso: o que a revisão faria sem snapshot
            ELSE COALESCE(NULLIF(cs.regra_cobranca, ''), regra_caso.primeira_ativa)
          END
        )
        -- Segunda metade por fora: jsonb_build_object aceita no máximo 100
        -- argumentos (mesmo arranjo de get_revisao_fatura).
        || jsonb_build_object(
          'horas_informadas', CASE WHEN i.tipo = 'timesheet' THEN i.horas ELSE 0::numeric END,
          'horas_revisadas', NULL,
          'horas_aprovadas', NULL,
          'valor_informado', i.valor,
          'valor_revisado', NULL,
          'valor_aprovado', NULL,
          'data_revisao', NULL,
          'data_aprovacao', NULL,
          'responsavel_revisao_id', NULL,
          'responsavel_aprovacao_id', NULL,
          'responsavel_revisao_nome', NULL,
          'responsavel_aprovacao_nome', NULL,
          'responsavel_fluxo_nome', NULL,
          'enviado_por_id', COALESCE(t.created_by, d.created_by),
          'enviado_por_nome', COALESCE(i.lancado_por, aut.nome),
          'enviado_por_foto', aut.foto_url,
          'revisor_foto', NULL,
          'aprovador_foto', NULL,
          'timesheet_id', t.id,
          'timesheet_data_lancamento', CASE WHEN t.data_lancamento IS NOT NULL THEN t.data_lancamento::date::text ELSE NULL END,
          'timesheet_horas', CASE WHEN i.tipo = 'timesheet' THEN i.horas ELSE 0::numeric END,
          'timesheet_descricao', COALESCE(t.descricao, ''),
          'timesheet_profissional', CASE WHEN i.tipo = 'timesheet' THEN COALESCE(aut.nome, '') ELSE '' END,
          -- Sem snapshot: o valor/hora da linha é o vigente (ou 0 quando a
          -- regra não precifica por linha — mensal sem excedente, teto).
          'timesheet_valor_hora', vha.valor_hora_atual,
          'valor_hora_atual', vha.valor_hora_atual,
          'periodo_inicio', v_inicio,
          'periodo_fim', v_fim,
          'competencia', v_inicio,
          'centro_custo_nome', ar_item.nome,
          'grupo_texto', NULL,
          'grupo_horas', NULL,
          'grupo_valor', NULL,
          'updated_at', COALESCE(t.updated_at, d.updated_at),
          'historico', '[]'::jsonb,
          'snapshot', jsonb_build_object(
            'timesheet_descricao', COALESCE(t.descricao, ''),
            'timesheet_profissional', CASE WHEN i.tipo = 'timesheet' THEN COALESCE(aut.nome, '') ELSE '' END,
            'timesheet_data_lancamento', CASE WHEN t.data_lancamento IS NOT NULL THEN t.data_lancamento::date::text ELSE NULL END,
            'timesheet_horas', CASE WHEN i.tipo = 'timesheet' THEN i.horas ELSE 0::numeric END,
            'valor_hora', vha.valor_hora_atual,
            'caso_nome', cs.nome,
            'caso_numero', cs.numero,
            'regra_cobranca', CASE
              WHEN i.tipo = 'timesheet' THEN i.caso_regra
              WHEN i.tipo = 'despesa' THEN 'despesa'
              ELSE COALESCE(NULLIF(cs.regra_cobranca, ''), regra_caso.primeira_ativa)
            END,
            'descricao', i.descricao
          )
        )
        ORDER BY cli.nome, c.numero NULLS LAST, cs.numero NULLS LAST,
                 (i.tipo = 'timesheet'), i.data_referencia NULLS LAST, i.descricao
      ),
      '[]'::jsonb
    )
    FROM itens i
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN i.tipo = 'timesheet' THEN 'timesheet'
        WHEN i.tipo = 'despesa' THEN 'despesa'
        ELSE 'regra_financeira'
      END::text AS origem_tipo
    ) ot
    JOIN crm.clientes cli
      ON cli.id = i.cliente_id
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.contratos c
      ON c.id = i.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = i.caso_id
     AND cs.tenant_id = v_tenant_id
    LEFT JOIN operations.timesheets t
      ON i.tipo = 'timesheet'
     AND t.id = i.origem_id
     AND t.tenant_id = v_tenant_id
    LEFT JOIN operations.despesas d
      ON i.tipo = 'despesa'
     AND d.id = i.origem_id
     AND d.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores aut
      ON aut.user_id = COALESCE(t.created_by, d.created_by)
     AND aut.tenant_id = v_tenant_id
    LEFT JOIN LATERAL (
      SELECT (
        SELECT NULLIF(r->>'regra_cobranca', '') FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
        ) r
        WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
          AND NULLIF(r->>'regra_cobranca', '') IS NOT NULL
        LIMIT 1
      ) AS primeira_ativa
    ) regra_caso ON true
    LEFT JOIN LATERAL (
      -- valor/hora VIGENTE, como a revisão calcula (tabela de preço por cargo
      -- congelado no lançamento; NULL = regra sem preço por linha => 0).
      SELECT CASE
        WHEN i.tipo = 'timesheet' THEN COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
        ELSE 0::numeric
      END AS valor_hora_atual
    ) vha ON true
    -- Área do item: p/ timesheet = área do autor; senão = 1º centro de custo do
    -- rateio do caso. Igual a get_revisao_fatura.
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        CASE WHEN i.tipo = 'timesheet' THEN aut.area_id ELSE NULL END,
        (SELECT NULLIF(rr->>'centro_custo_id', '')::uuid
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
           WHERE NULLIF(rr->>'centro_custo_id', '') IS NOT NULL
           LIMIT 1)
      ) AS area_id
    ) ia ON true
    LEFT JOIN people.areas ar_item ON ar_item.id = ia.area_id AND ar_item.tenant_id = v_tenant_id
    WHERE (
        v_can_view_all
        -- item de timesheet: área do autor = área do gestor
        OR (i.tipo = 'timesheet' AND aut.area_id = v_viewer_area_id)
        -- qualquer item: centro de custo (rateio) do caso inclui a área do gestor
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      -- (c) Regra que já virou billing_item nesta competência sai da fila.
      AND (
        i.tipo IN ('timesheet', 'despesa')
        OR NOT EXISTS (
          SELECT 1
          FROM finance.billing_items bi
          WHERE bi.tenant_id = v_tenant_id
            AND bi.origem_tipo = 'regra_financeira'
            AND bi.caso_id = cs.id
            AND bi.status <> 'cancelado'
            AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_inicio
            AND (
              -- mesma linha (id com o sufixo do mês/parcela)
              bi.origem_id = i.origem_id
              OR (
                -- item gerado pela REGRA do caso, do mesmo tipo de cobrança
                -- desta linha — e a linha não é um adiamento entrando no mês
                NOT EXISTS (
                  SELECT 1
                  FROM finance.faturamento_adiamentos a
                  WHERE a.tenant_id = v_tenant_id
                    AND a.origem_id = i.origem_id
                    AND a.periodo_novo = v_inicio
                    AND a.desfeito_em IS NULL
                )
                AND CASE i.tipo
                  WHEN 'mensal' THEN bi.snapshot->>'regra_cobranca' IN ('mensal', 'mensalidade_carteira')
                  WHEN 'mensalidade_processo' THEN bi.snapshot->>'regra_cobranca' IN ('mensalidade_processo', 'salario_minimo')
                  WHEN 'projeto' THEN bi.snapshot->>'regra_cobranca' IN ('projeto', 'pro_labore')
                  WHEN 'projeto_parcela' THEN bi.snapshot->>'regra_cobranca' IN ('projeto', 'pro_labore')
                  WHEN 'exito' THEN bi.snapshot->>'regra_cobranca' = 'exito'
                  ELSE false
                END
              )
            )
        )
      )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_fila_por_competencia(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fila_por_competencia(uuid, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
