-- =====================================================================
-- Rateio / horas — dois ajustes pedidos pelo cliente (26/10) sobre
-- 20261022100000_rateio_horas.sql. Mesmas assinaturas; fonte = produção
-- (pg_get_functiondef em 26/10).
--
-- 1. ACESSO (finance.pode_ver_rateio_horas): sai a regra "área Financeiro"
--    — a conta da recepção também é dessa área e não deve ver o relatório.
--    Agora:
--      tenant ativo + leitura do faturamento + colaborador ATIVO, e
--      (categoria 'socio' OU super-admin ('*') OU liberação nominal
--       'finance.rateio_horas.read' em core.capacidades_sensiveis).
--    O super-admin passa a exigir colaborador ativo como os demais (em
--    26/10 ninguém tem '*'). A liberação nominal é concedida abaixo a quem
--    o cliente indicou, no mesmo padrão das outras concessões nominais.
--    public.pode_ver_rateio_horas só repassa para esta função e não muda.
--
-- 2. FORA DO FATURAMENTO (get_rateio_horas): timesheet SEM item de
--    faturamento ativo cujo contrato não está ativo ou cujo caso está
--    inativo nunca entra no faturamento (a fila não mostra, o gerador não
--    fatura). Antes contava como 'cortada' e inflava lançadas e cut; agora
--    tem situação própria, 'fora_faturamento' (etapa continua
--    'fora_da_fila'), que o front deixa FORA de lançadas/cobradas/cut e
--    mostra à parte. A checagem passa para antes da de "excluído da fila":
--    hora excluída de contrato/caso inativo também nunca seria faturada,
--    nem voltando da Lixeira. Timesheet que JÁ tem item segue o item (foi
--    ao faturamento; se foi ignorado, é corte de verdade).
-- =====================================================================

INSERT INTO core.capacidades_sensiveis (tenant_id, user_id, capacidade)
SELECT c.tenant_id, c.user_id, 'finance.rateio_horas.read'
FROM people.colaboradores c
WHERE c.ativo
  AND c.user_id IS NOT NULL
  AND lower(c.email) = 'jessika.lira@vlma.com.br'
ON CONFLICT (tenant_id, user_id, capacidade) DO NOTHING;

CREATE OR REPLACE FUNCTION finance.pode_ver_rateio_horas(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people', 'finance'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_categoria text;
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

  SELECT col.categoria::text, COALESCE(col.ativo, false)
  INTO v_categoria, v_ativo
  FROM people.colaboradores col
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  IF NOT COALESCE(v_ativo, false) THEN
    RETURN false;
  END IF;

  -- Área NÃO libera mais (a recepção também é da área Financeiro): fora o
  -- sócio e o super-admin, só quem tem a liberação nominal.
  RETURN v_categoria = 'socio'
    OR EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key = '*')
    OR EXISTS (
      SELECT 1 FROM core.capacidades_sensiveis g
      WHERE g.user_id = p_user_id
        AND g.tenant_id = v_tenant_id
        AND g.capacidade = 'finance.rateio_horas.read'
    );
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
    RAISE EXCEPTION 'Sem permissão para ver o rateio de horas (só sócios e quem tem liberação)';
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
          -- sem item e com contrato/caso inativo: nunca entra no faturamento,
          -- nem se voltar da Lixeira (a fila não mostra, o gerador não fatura)
          WHEN NOT b.na_fila_ok THEN 'fora_da_fila'
          WHEN b.excluido_faturamento THEN 'excluido_fila'
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
            WHEN x.etapa = 'fora_da_fila' THEN 'fora_faturamento'
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
  'Rateio / horas (Faturamento): uma linha por timesheet de caso por hora na competência, com horas lançadas, cobradas, situação (cobrada, cortada, em_revisao, fora_faturamento) e centro de custo (área de quem lançou). Só sócios, super-admin e liberação nominal finance.rateio_horas.read.';

REVOKE ALL ON FUNCTION finance.pode_ver_rateio_horas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.pode_ver_rateio_horas(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_rateio_horas(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rateio_horas(uuid, date) TO authenticated, service_role;
