-- =====================================================================
-- Rateio / horas: relatório gerencial de horas lançadas x cobradas por mês
-- de faturamento, com a divisão das cobradas por centro de custo.
--
-- Pedido do cliente (22/10): sócios e financeiro querem ver, por competência,
-- quanto foi lançado, quanto foi cobrado, o cut (1 − cobradas ÷ lançadas) e
-- quanto das horas cobradas veio de cada área. Subaba "Rateio / horas" na
-- tela de Faturamento, ao lado de Indicadores.
--
-- O QUE ENTRA (uma linha por timesheet):
--   * Só timesheet não apagado (apagado_em IS NULL — Lixeira etapa 2).
--   * Só caso que cobra por hora — mesma conta da aba "Horas" (regra_caso.
--     tem_hora de get_revisao_fatura / caso_regra de get_itens_a_faturar):
--     regra ativa 'hora'/'hora_com_cap' em regras_financeiras, ou
--     casos.regra_cobranca 'hora'/'hora_com_cap'. É a regra ATUAL do caso,
--     como a Revisão faz para item de timesheet.
--
-- COMPETÊNCIA (mês de faturamento — a aba de outubro mostra o que é faturado
-- em outubro, trabalhado em setembro), a mesma regra das duas metades da tela:
--   * timesheet com item de faturamento ativo (status <> 'cancelado'; o
--     índice idx_billing_items_unique_timesheet_once garante no máximo um):
--     a competência do ITEM, como get_revisao_fatura —
--     date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date)).
--   * sem item ativo (na fila, excluído da fila, ou item cancelado ao
--     postergar): a competência do TIMESHEET, como get_itens_a_faturar —
--     date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento)).
--
-- HORAS:
--   * lançadas = timesheets.horas.
--   * cobradas = só item 'aprovado' ou 'faturado': horas_aprovadas; sem ela,
--     a soma das linhas revisadas do snapshot (timesheet_itens_revisao, mesmo
--     critério por linha da Revisão: horas_revisadas > horas > horas_iniciais),
--     depois horas_revisadas e horas_informadas — mesma cadeia de
--     get_indicadores_faturamento. Em produção (22/10) horas_aprovadas nunca é
--     nula em item aprovado/faturado e bate com a soma das linhas.
--   * Ignorado, excluído da fila ou fora da fila = 0 cobradas.
--
-- SITUAÇÃO (o front agrega por ela):
--   cobrada    — aprovado/faturado com horas cobradas > 0;
--   cortada    — ignorado, aprovado com 0h, excluído da fila (Lixeira etapa 1)
--                ou fora da fila (contrato inativo / caso inativo: a fila não
--                mostra e o gerador não fatura);
--   em_revisao — ainda pode ser cobrada: na fila, em revisão, em aprovação.
--   'etapa' guarda o detalhe (na_fila, em_revisao, em_aprovacao, aprovado,
--   faturado, ignorado, excluido_fila, fora_da_fila).
--
-- CENTRO DE CUSTO = área da pessoa que lançou: timesheets.created_by →
-- people.colaboradores.user_id → area_id → people.areas (o mesmo vínculo que
-- get_revisao_fatura usa em ts_colab). Sem área: NULL ("Sem centro de
-- custo" no front).
--
-- ACESSO: sócios e financeiro (finance.pode_ver_rateio_horas):
--   * tenant ativo + leitura do faturamento (mesma lista de chaves de
--     get_revisao_fatura) + colaborador ATIVO, e
--   * categoria 'socio', OU área 'Financeiro', OU super-admin ('*'), OU
--     concessão nominal em core.capacidades_sensiveis com a capacidade
--     'finance.rateio_horas.read' (para liberar alguém fora dessas regras sem
--     mudar código).
--   Não usa finance.escopo_faturamento.can_view_all: ela também libera quem
--   não tem área e toda a área VLMA (estagiário incluído), e o relatório é
--   o escritório inteiro — não tem versão "só da minha área". Sócio de área
--   vê tudo aqui, de propósito: o relatório compara as áreas.
--
-- Agregação (totais, cut, colunas por centro de custo, filtros) fica no
-- front, em src/lib/faturamento/rateio-horas.ts (lib pura, com teste): o
-- volume é de centenas de linhas por mês e os filtros mudam sem nova ida ao
-- banco. Esta RPC só devolve as linhas.
-- =====================================================================

CREATE OR REPLACE FUNCTION finance.pode_ver_rateio_horas(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people', 'finance'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_categoria text;
  v_area_nome text;
  v_ativo boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read', 'finance.faturamento.review',
      'finance.faturamento.approve', 'finance.faturamento.manage',
      'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key = '*') THEN
    RETURN true;
  END IF;

  SELECT col.categoria::text, a.nome, COALESCE(col.ativo, false)
  INTO v_categoria, v_area_nome, v_ativo
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  IF NOT COALESCE(v_ativo, false) THEN
    RETURN false;
  END IF;

  RETURN v_categoria = 'socio'
    OR v_area_nome = 'Financeiro'
    OR EXISTS (
      SELECT 1 FROM core.capacidades_sensiveis g
      WHERE g.user_id = p_user_id
        AND g.tenant_id = v_tenant_id
        AND g.capacidade = 'finance.rateio_horas.read'
    );
END;
$function$;

-- Para o front decidir se mostra o botão "Rateio / horas". A RPC de leitura
-- refaz a checagem; isto aqui só evita mostrar um botão que daria erro.
CREATE OR REPLACE FUNCTION public.pode_ver_rateio_horas(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance'
AS $function$
BEGIN
  -- Em chamada autenticada vale a identidade do token (como na Lixeira).
  RETURN finance.pode_ver_rateio_horas(COALESCE(auth.uid(), p_user_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_rateio_horas(p_user_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_comp date := date_trunc('month', p_competencia)::date;
BEGIN
  -- Em chamada autenticada vale a identidade do token (como na Lixeira).
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT finance.pode_ver_rateio_horas(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver o rateio de horas (só sócios e financeiro)';
  END IF;

  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Informe a competência';
  END IF;

  RETURN (
    WITH base AS (
      SELECT
        t.id AS timesheet_id,
        t.data_lancamento::date AS data_lancamento,
        COALESCE(t.descricao, '') AS descricao,
        COALESCE(t.horas, 0)::numeric AS horas_lancadas,
        t.created_by,
        t.excluido_faturamento,
        c.id AS contrato_id,
        COALESCE(c.numero_sequencial, c.numero) AS contrato_numero,
        (c.status = 'ativo' AND cs.status <> 'inativo') AS na_fila_ok,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        bi.id AS billing_item_id,
        bi.status AS bi_status,
        COALESCE(
          bi.horas_aprovadas,
          (
            SELECT sum(COALESCE(
              NULLIF(r->>'horas_revisadas', '')::numeric,
              NULLIF(r->>'horas', '')::numeric,
              NULLIF(r->>'horas_iniciais', '')::numeric,
              0
            ))
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(bi.snapshot->'timesheet_itens_revisao') = 'array'
                   THEN bi.snapshot->'timesheet_itens_revisao' ELSE '[]'::jsonb END
            ) r
          ),
          bi.horas_revisadas,
          bi.horas_informadas,
          0
        )::numeric AS horas_item
      FROM operations.timesheets t
      JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
      LEFT JOIN finance.billing_items bi
        ON bi.tenant_id = v_tenant_id
       AND bi.origem_tipo = 'timesheet'
       AND bi.origem_id = t.id
       AND bi.status <> 'cancelado'
      WHERE t.tenant_id = v_tenant_id
        AND t.apagado_em IS NULL
        -- competência: do item ativo se houver; senão a do timesheet
        AND COALESCE(
              date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date)),
              date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento::date))
            )::date = v_comp
        -- caso que cobra por hora (mesma conta da aba Horas)
        AND (
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
            ) r
            WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
              AND NULLIF(r->>'regra_cobranca', '') IN ('hora', 'hora_com_cap')
          )
          OR NULLIF(cs.regra_cobranca, '') IN ('hora', 'hora_com_cap')
        )
    ),
    classificado AS (
      SELECT
        b.*,
        CASE
          WHEN b.bi_status IN ('aprovado', 'faturado') THEN b.bi_status
          WHEN b.bi_status = 'ignorado' THEN 'ignorado'
          WHEN b.bi_status IN ('em_revisao', 'em_aprovacao') THEN b.bi_status
          WHEN b.bi_status IS NOT NULL THEN 'em_revisao' -- 'disponivel' e afins: ainda no fluxo
          WHEN b.excluido_faturamento THEN 'excluido_fila'
          WHEN NOT b.na_fila_ok THEN 'fora_da_fila'
          ELSE 'na_fila'
        END AS etapa,
        CASE WHEN b.bi_status IN ('aprovado', 'faturado') THEN b.horas_item ELSE 0::numeric END AS horas_cobradas
      FROM base b
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'timesheet_id', x.timesheet_id,
          'billing_item_id', x.billing_item_id,
          'competencia', v_comp,
          'data_lancamento', x.data_lancamento,
          'descricao', x.descricao,
          'cliente_id', x.cliente_id,
          'cliente_nome', x.cliente_nome,
          'contrato_id', x.contrato_id,
          'contrato_numero', x.contrato_numero,
          'caso_id', x.caso_id,
          'caso_numero', x.caso_numero,
          'caso_nome', x.caso_nome,
          'usuario_id', x.created_by,
          'usuario_nome', COALESCE(NULLIF(trim(col.nome), ''), 'Sem nome'),
          'area_id', ar.id,
          'area_nome', ar.nome,
          'horas_lancadas', x.horas_lancadas,
          'horas_cobradas', x.horas_cobradas,
          'etapa', x.etapa,
          'situacao', CASE
            WHEN x.etapa IN ('aprovado', 'faturado') AND x.horas_cobradas > 0 THEN 'cobrada'
            WHEN x.etapa IN ('na_fila', 'em_revisao', 'em_aprovacao') THEN 'em_revisao'
            ELSE 'cortada'
          END
        )
        ORDER BY x.cliente_nome, x.caso_numero NULLS LAST, x.data_lancamento, col.nome
      ),
      '[]'::jsonb
    )
    FROM classificado x
    LEFT JOIN people.colaboradores col ON col.user_id = x.created_by AND col.tenant_id = v_tenant_id
    LEFT JOIN people.areas ar ON ar.id = col.area_id AND ar.tenant_id = v_tenant_id
  );
END;
$function$;

COMMENT ON FUNCTION public.get_rateio_horas(uuid, date) IS
  'Rateio / horas (Faturamento): uma linha por timesheet de caso por hora na competência, com horas lançadas, cobradas, situação e centro de custo (área de quem lançou). Só sócios e financeiro.';

REVOKE ALL ON FUNCTION finance.pode_ver_rateio_horas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.pode_ver_rateio_horas(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.pode_ver_rateio_horas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_rateio_horas(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_rateio_horas(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rateio_horas(uuid, date) TO authenticated, service_role;
