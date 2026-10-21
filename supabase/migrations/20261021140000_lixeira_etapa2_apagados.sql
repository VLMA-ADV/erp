-- =====================================================================
-- Lixeira do faturamento, etapa 2 (aprovada): timesheet e despesa APAGADOS
-- nas telas de lançamento viram soft delete e vão para a mesma lixeira.
--
-- Até aqui delete_timesheet / delete_despesa (chamadas pelas edges
-- delete-timesheet / delete-despesa) faziam DELETE de verdade. Agora gravam
-- apagado_em / apagado_por e o registro some de tudo; restaurar devolve o
-- registro como estava. Retenção de 12 meses, igual à etapa 1: passado o
-- prazo o registro só SAI da lixeira — continua no banco, apagado, para
-- sempre. Não existe job de expurgo.
--
-- O QUE O APAGAR FAZ COM O FATURAMENTO (mesmo efeito do DELETE de antes):
--   * Timesheet: item de faturamento ainda não revisado (disponivel /
--     em_revisao, sem revisão registrada) é CANCELADO; revisado, aprovado,
--     faturado ou ignorado BLOQUEIA ("peça ao revisor para reabrir").
--     Lançamento aprovado também bloqueia. Mudança: item já cancelado não
--     bloqueia mais — antes um lançamento que tinha voltado para a fila
--     (postergado, item cancelado) não podia ser apagado.
--   * Despesa: o DELETE antigo só bloqueava despesa aprovada e deixava o item
--     de faturamento pendurado — despesa em revisão/aprovação apagada seguia
--     no kit e seria cobrada. Agora segue a regra do timesheet: item aberto
--     não revisado é cancelado, item revisado/em aprovação bloqueia. Despesa
--     de lote em validação/fechado também bloqueia (mesma trava da edição:
--     o saldo do lote já virou lançamento).
--   * Faturado nunca é apagado: timesheet faturado tem item 'faturado' e
--     despesa faturada fica 'aprovado' — ambos já bloqueavam.
--
-- RESTAURAR (permissão nominal finance.faturamento.lixeira.restore, como na
-- etapa 1): limpa apagado_em e põe o registro na fila conforme a regra de
-- competência da etapa 1 — periodo_faturamento = GREATEST(mês corrente,
-- competência original). Timesheet que também estava excluído da fila volta
-- a ser só "excluído" (aparece de novo na lixeira como tal) e a competência
-- não é tocada. Despesa de lote que fechou depois de apagada não volta
-- (contaria no saldo de um lote já acertado) e sai em 'ignorados'.
--
-- FILTRO apagado_em IS NULL — auditoria de TODAS as funções que leem
-- operations.timesheets / operations.despesas em produção (21/10/2026; não
-- há views nem cron que as leiam; as edges só chamam RPC, exceto o atalho de
-- update-timesheet que só grava periodo_faturamento por id):
--   ganham o filtro (listas, somatórios, fila, gerador, indicadores, escrita):
--     get_timesheets, get_minhas_horas_resumo, get_gestao_horas,
--     get_gestao_geral, get_indicadores_faturamento, get_itens_a_faturar
--     (=> get_fila_por_competencia), get_faturamento_postergados,
--     cp_receita_prevista, validar_precos_antes_de_liberar,
--     start_faturamento_flow, excluir_timesheets_do_faturamento,
--     restaurar_timesheets_lixeira, postergar_timesheet,
--     set_timesheet_periodo_faturamento, set_timesheet_status,
--     update_timesheet, reset_faturamento_periodo;
--     get_despesas, get_despesas_dashboard, get_fila_por_competencia
--     (despesas), start_faturamento_despesas_fallback, update_despesa,
--     operations.saldo_lote_despesa (=> get_lotes_despesa,
--     validar_lote_despesa), get_lotes_despesa, cancelar_lote_despesa.
--   reescritas: delete_timesheet, delete_despesa, get_lixeira_faturamento;
--   nova: restaurar_lixeira_faturamento.
--   ficam como estão (lista fixa no bloco de conferência do fim):
--     partem de um billing_item vivo (o de registro apagado está cancelado):
--       get_revisao_fatura, get_composicao_fatura, update_revisao_fatura_item,
--       transferir_billing_item_caso, excluir_kit, bol_devolver_itens_da_nota,
--       recalcular_valores_hora_do_caso, recalcular_aprovados_apos_regra,
--       sync_despesa_status_from_billing_item;
--     por id, sem lista: get_despesa_arquivo, get_anexos_das_despesas,
--       despesa_sem_comprovante;
--     só inserem: create_timesheet, create_despesa.
--
-- start_faturamento_flow também passa a respeitar excluido_faturamento: o
-- gerador não lia a coluna, então "Gerar faturamento" por cliente/contrato/
-- caso (sem seleção de itens) ainda pegaria hora excluída da fila. Em
-- 21/10 nenhuma hora excluída tinha item ativo, mas era o mesmo buraco.
--
-- As definições alteradas são as de PRODUÇÃO de 21/10/2026, só com o filtro
-- acrescentado. O bloco final confere, no momento de aplicar, que toda
-- função que lê as duas tabelas tem o filtro ou está na lista acima — se
-- alguém criou/alterou uma no meio do caminho, a migration aborta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------
ALTER TABLE operations.timesheets
  ADD COLUMN IF NOT EXISTS apagado_em timestamptz,
  ADD COLUMN IF NOT EXISTS apagado_por uuid;

ALTER TABLE operations.despesas
  ADD COLUMN IF NOT EXISTS apagado_em timestamptz,
  ADD COLUMN IF NOT EXISTS apagado_por uuid;

COMMENT ON COLUMN operations.timesheets.apagado_em IS
  'Apagado na tela de lancamento (soft delete). Preenchido = some de listas, somatorios, fila e relatorios; fica na lixeira do faturamento por 12 meses e nunca e removido.';
COMMENT ON COLUMN operations.despesas.apagado_em IS
  'Apagada na tela de lancamento (soft delete). Preenchido = some de listas, somatorios, fila, lotes e relatorios; fica na lixeira do faturamento por 12 meses e nunca e removida.';

CREATE INDEX IF NOT EXISTS timesheets_apagados_idx
  ON operations.timesheets (tenant_id, apagado_em) WHERE apagado_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS despesas_apagadas_idx
  ON operations.despesas (tenant_id, apagado_em) WHERE apagado_em IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Apagar timesheet: mesmas travas de antes; DELETE vira marca.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_timesheet(p_user_id uuid, p_timesheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_dono uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT status, created_by INTO v_status, v_dono
  FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id
    AND apagado_em IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  -- Antes não havia trava nenhuma: qualquer um com permissão de timesheet
  -- apagava lançamento de qualquer pessoa. Passa a valer a mesma regra da edição.
  IF NOT public.pode_editar_timesheet_de(p_user_id, v_dono) THEN
    RAISE EXCEPTION 'Você não pode excluir o lançamento de outra pessoa. Só o autor, a diretoria ou o gestor da área dele podem.';
  END IF;

  IF v_status = 'aprovado' THEN
    RAISE EXCEPTION 'Não é possível excluir um lançamento já aprovado. Reabra a revisão antes.';
  END IF;

  -- Se o lançamento já entrou na fase de revisão E alguém já mexeu nele
  -- (revisou/avançou), a exclusão é bloqueada. Item cancelado não conta: o
  -- lançamento já voltou para a fila (21/10: antes contava e travava).
  IF EXISTS (
    SELECT 1
    FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id
      AND bi.origem_tipo = 'timesheet'
      AND bi.origem_id = p_timesheet_id
      AND bi.status <> 'cancelado'
      AND (
        bi.status NOT IN ('disponivel', 'em_revisao')
        OR bi.data_revisao IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM finance.revisao_fatura_itens_historico h
          WHERE h.billing_item_id = bi.id AND h.role IN ('REVISOR', 'APROVADOR')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Este lançamento já foi revisado no faturamento. Peça ao revisor para reabrir antes de excluir.';
  END IF;

  -- Cancela o item de faturamento ainda não revisado (evita item órfão na grid).
  UPDATE finance.billing_items bi
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE bi.tenant_id = v_tenant_id
    AND bi.origem_tipo = 'timesheet'
    AND bi.origem_id = p_timesheet_id
    AND bi.status IN ('disponivel', 'em_revisao');

  -- Soft delete (lixeira etapa 2): o registro fica, marcado, e some de tudo.
  UPDATE operations.timesheets
  SET apagado_em = now(), apagado_por = p_user_id,
      updated_at = now(), updated_by = p_user_id
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_timesheet_id, 'lixeira', true);
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Apagar despesa: trava de aprovada (de antes) + regra do item igual à do
--    timesheet + trava de lote fechado (igual à edição).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_despesa(p_user_id uuid, p_despesa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_lote_id uuid;
  v_cancelados int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT status, lote_id INTO v_status, v_lote_id
  FROM operations.despesas
  WHERE id = p_despesa_id AND tenant_id = v_tenant_id
    AND apagado_em IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  IF v_status = 'aprovado' THEN
    RAISE EXCEPTION 'Não é possível excluir uma despesa já aprovada. Reabra a revisão antes.';
  END IF;

  -- Mesma trava de update_despesa: o saldo do lote já virou lançamento.
  IF v_lote_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM operations.despesa_lotes l
    WHERE l.id = v_lote_id AND l.status IN ('em_validacao', 'fechado')
  ) THEN
    RAISE EXCEPTION 'Lote já foi fechado: reabra o lote para excluir esta despesa';
  END IF;

  -- Mesma regra do timesheet. Antes a despesa era apagada e o item ficava
  -- vivo no kit (em revisão/aprovação), sem a despesa por trás.
  IF EXISTS (
    SELECT 1
    FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id
      AND bi.origem_tipo = 'despesa'
      AND bi.origem_id = p_despesa_id
      AND bi.status <> 'cancelado'
      AND (
        bi.status NOT IN ('disponivel', 'em_revisao')
        OR bi.data_revisao IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM finance.revisao_fatura_itens_historico h
          WHERE h.billing_item_id = bi.id AND h.role IN ('REVISOR', 'APROVADOR')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Esta despesa já foi revisada no faturamento. Peça ao revisor para reabrir antes de excluir.';
  END IF;

  -- Cancela o item ainda não revisado. O trigger
  -- trg_sync_despesa_status_from_billing_item põe a despesa em 'cancelado';
  -- o UPDATE abaixo a devolve a 'em_lancamento' — sem item vivo, é o estado
  -- dela na fila, e é como volta se for restaurada.
  UPDATE finance.billing_items bi
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE bi.tenant_id = v_tenant_id
    AND bi.origem_tipo = 'despesa'
    AND bi.origem_id = p_despesa_id
    AND bi.status IN ('disponivel', 'em_revisao');
  GET DIAGNOSTICS v_cancelados = ROW_COUNT;

  UPDATE operations.despesas
  SET apagado_em = now(), apagado_por = p_user_id,
      status = CASE WHEN v_cancelados > 0 THEN 'em_lancamento' ELSE v_status END,
      updated_at = now(), updated_by = p_user_id
  WHERE id = p_despesa_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_despesa_id, 'lixeira', true);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. Lixeira com os três tipos. Mesma assinatura e mesmas chaves da etapa 1
--    (excluido_por_* / excluido_em = quem/quando, para qualquer tipo), mais
--    tipo, id, chave, valor, categoria.
--      tipo = 'excluido_fila' | 'timesheet_apagado' | 'despesa_apagada'
--    Timesheet apagado que também estava excluído aparece uma vez só, como
--    apagado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lixeira_faturamento(
  p_user_id uuid, p_busca text DEFAULT NULL, p_mes date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_pode_restaurar boolean := false;
  v_busca text := NULLIF(trim(COALESCE(p_busca, '')), '');
  v_mes date := date_trunc('month', p_mes)::date;
  v_limite timestamptz := now() - interval '12 months';
  v_itens jsonb;
BEGIN
  -- Em chamada autenticada vale a identidade do token (como get_user_permissions).
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT e.tenant_id, e.can_view_all, e.viewer_area_id
  INTO v_tenant_id, v_can_view_all, v_viewer_area_id
  FROM finance.escopo_faturamento(p_user_id) e;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Mesma lista de leitura de get_revisao_fatura: a lixeira mora na revisão.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read', 'finance.faturamento.review',
      'finance.faturamento.approve', 'finance.faturamento.manage',
      'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar revisão de fatura';
  END IF;

  v_pode_restaurar := finance._tem_permissao_nominal(p_user_id, 'finance.faturamento.lixeira.restore');
  -- Quem restaura enxerga a lixeira inteira, independente da área.
  v_can_view_all := v_can_view_all OR v_pode_restaurar;

  WITH fontes AS (
    -- Etapa 1: hora excluída da fila (e não apagada).
    SELECT 'excluido_fila'::text AS tipo, t.id, t.contrato_id, t.caso_id, t.created_by,
           t.data_lancamento::date AS data_lancamento, COALESCE(t.horas, 0)::numeric AS horas,
           NULL::numeric AS valor, NULL::text AS categoria, COALESCE(t.descricao, '') AS descricao,
           t.excluido_faturamento_por AS quem_id, t.excluido_faturamento_em AS quando,
           t.excluido_faturamento_motivo AS motivo,
           date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento::date))::date AS mes
    FROM operations.timesheets t
    WHERE t.tenant_id = v_tenant_id
      AND t.apagado_em IS NULL
      AND t.excluido_faturamento
      AND t.excluido_faturamento_em >= v_limite
    UNION ALL
    -- Etapa 2: hora apagada na tela de Timesheet.
    SELECT 'timesheet_apagado', t.id, t.contrato_id, t.caso_id, t.created_by,
           t.data_lancamento::date, COALESCE(t.horas, 0)::numeric,
           NULL::numeric, NULL::text, COALESCE(t.descricao, ''),
           t.apagado_por, t.apagado_em, NULL::text,
           date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento::date))::date
    FROM operations.timesheets t
    WHERE t.tenant_id = v_tenant_id
      AND t.apagado_em >= v_limite
    UNION ALL
    -- Etapa 2: despesa apagada na tela de Despesas.
    SELECT 'despesa_apagada', d.id, d.contrato_id, d.caso_id, d.created_by,
           d.data_lancamento::date, 0::numeric,
           COALESCE(d.valor, 0)::numeric, d.categoria::text, COALESCE(d.descricao, ''),
           d.apagado_por, d.apagado_em, NULL::text,
           date_trunc('month', COALESCE(d.periodo_faturamento, d.data_lancamento::date))::date
    FROM operations.despesas d
    WHERE d.tenant_id = v_tenant_id
      AND d.apagado_em >= v_limite
  )
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.quando DESC), '[]'::jsonb)
  INTO v_itens
  FROM (
    SELECT
      f.quando,
      jsonb_build_object(
        'tipo', f.tipo,
        'id', f.id,
        'chave', f.tipo || ':' || f.id::text,
        'timesheet_id', CASE WHEN f.tipo <> 'despesa_apagada' THEN f.id END,
        'despesa_id', CASE WHEN f.tipo = 'despesa_apagada' THEN f.id END,
        'cliente_id', cli.id,
        'cliente_nome', cli.nome,
        'contrato_id', c.id,
        'contrato_numero', c.numero,
        -- Número canônico para exibir (20261009120000): filtros seguem em numero.
        'contrato_numero_sequencial', COALESCE(c.numero_sequencial, c.numero),
        'contrato_nome', c.nome_contrato,
        'contrato_ativo', c.status = 'ativo',
        'caso_id', cs.id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'caso_ativo', cs.status <> 'inativo',
        'profissional_nome', COALESCE(aut.nome, ''),
        'data_lancamento', f.data_lancamento,
        'horas', f.horas,
        'valor', f.valor,
        'categoria', f.categoria,
        'descricao', f.descricao,
        'excluido_por_id', f.quem_id,
        'excluido_por_nome', COALESCE(exc.nome, ''),
        'excluido_em', f.quando,
        'motivo', f.motivo,
        -- Competência em que estava quando saiu (regra da fila).
        'mes_original', f.mes,
        -- Para onde volta ao restaurar (mesma regra de restaurar_lixeira_faturamento).
        'mes_destino', GREATEST(date_trunc('month', CURRENT_DATE)::date, f.mes),
        'expira_em', f.quando + interval '12 months',
        'dias_restantes', GREATEST(0, ceil(EXTRACT(EPOCH FROM (f.quando + interval '12 months' - now())) / 86400.0))::int,
        -- Aviso antes de restaurar: o mês original já tem kit (item
        -- aprovado/faturado do caso) e/ou NFS-e viva sobre ele. Mesma regra
        -- de competência e de NFS-e de excluir_kit.
        'kit_no_mes_original', kit.tem_kit,
        'nfse_no_mes_original', nf.nfse_numero
      ) AS item
    FROM fontes f
    JOIN contracts.contratos c ON c.id = f.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs ON cs.id = f.caso_id AND cs.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores aut ON aut.user_id = f.created_by AND aut.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores exc ON exc.user_id = f.quem_id AND exc.tenant_id = v_tenant_id
    LEFT JOIN LATERAL (
      SELECT array_agg(bi.id) AS ids, count(*) > 0 AS tem_kit
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.status IN ('aprovado', 'faturado')
        AND bi.contrato_id = f.contrato_id
        AND bi.caso_id IS NOT DISTINCT FROM f.caso_id
        AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = f.mes
    ) kit ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                      NULLIF(bn.metadata->>'nfse_numero', ''),
                      bn.numero::text) AS nfse_numero
      FROM finance.billing_notes bn
      WHERE kit.ids IS NOT NULL
        AND bn.tenant_id = v_tenant_id
        AND bn.tipo_documento = 'nota_fiscal_servico'
        AND bn.status = 'gerado'
        AND bn.focus_status IN ('autorizado', 'processando')
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) xi
          WHERE xi.value::uuid = ANY (kit.ids)
        )
      ORDER BY bn.created_at DESC
      LIMIT 1
    ) nf ON true
    WHERE (
        v_can_view_all
        OR aut.area_id = v_viewer_area_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      AND (v_mes IS NULL OR f.mes = v_mes)
      AND (
        v_busca IS NULL
        OR cli.nome ILIKE '%' || v_busca || '%'
        OR c.nome_contrato ILIKE '%' || v_busca || '%'
        OR cs.nome ILIKE '%' || v_busca || '%'
        OR c.numero::text ILIKE '%' || v_busca || '%'
        OR COALESCE(c.numero_sequencial, c.numero)::text ILIKE '%' || v_busca || '%'
        OR cs.numero::text ILIKE '%' || v_busca || '%'
        OR f.descricao ILIKE '%' || v_busca || '%'
        OR f.categoria ILIKE '%' || v_busca || '%'
        OR aut.nome ILIKE '%' || v_busca || '%'
      )
  ) x;

  RETURN jsonb_build_object(
    'pode_restaurar', v_pode_restaurar,
    'mes_destino', date_trunc('month', CURRENT_DATE)::date,
    'itens', v_itens
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Restaurar qualquer tipo, numa chamada só (atômica). Excluídos da fila
--    seguem por restaurar_timesheets_lixeira (etapa 1).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restaurar_lixeira_faturamento(
  p_user_id uuid,
  p_excluidos uuid[] DEFAULT '{}'::uuid[],
  p_timesheets uuid[] DEFAULT '{}'::uuid[],
  p_despesas uuid[] DEFAULT '{}'::uuid[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_mes date := date_trunc('month', CURRENT_DATE)::date;
  v_limite timestamptz := now() - interval '12 months';
  v_exc jsonb := '{}'::jsonb;
  v_n_exc int := 0;
  v_n_ts int := 0;
  v_n_desp int := 0;
  v_pedidos int := COALESCE(cardinality(p_excluidos), 0)
                 + COALESCE(cardinality(p_timesheets), 0)
                 + COALESCE(cardinality(p_despesas), 0);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT finance._tem_permissao_nominal(p_user_id, 'finance.faturamento.lixeira.restore') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar lançamentos da lixeira do faturamento';
  END IF;

  IF COALESCE(cardinality(p_excluidos), 0) > 0 THEN
    v_exc := public.restaurar_timesheets_lixeira(p_user_id, p_excluidos);
    v_n_exc := COALESCE((v_exc->>'afetados')::int, 0);
  END IF;

  -- Timesheet apagado: volta como estava. Se não estava excluído da fila, vai
  -- para a fila pela regra da etapa 1 (mês original já passou -> mês corrente;
  -- futuro -> fica) com o marcador que tira de Postergados. Se estava
  -- excluído, continua excluído e a competência não muda.
  IF COALESCE(cardinality(p_timesheets), 0) > 0 THEN
    UPDATE operations.timesheets t
    SET apagado_em = NULL,
        apagado_por = NULL,
        periodo_faturamento = CASE WHEN t.excluido_faturamento THEN t.periodo_faturamento
          ELSE GREATEST(v_mes, COALESCE(t.periodo_faturamento, t.data_lancamento::date)) END,
        restaurado_da_lixeira_em = CASE WHEN t.excluido_faturamento THEN t.restaurado_da_lixeira_em ELSE now() END,
        restaurado_da_lixeira_por = CASE WHEN t.excluido_faturamento THEN t.restaurado_da_lixeira_por ELSE p_user_id END,
        updated_at = now(),
        updated_by = p_user_id
    WHERE t.tenant_id = v_tenant_id
      AND t.id = ANY(p_timesheets)
      AND t.apagado_em >= v_limite
      -- Por garantia (apagar cancela o item aberto): com item vivo contaria
      -- em dobro.
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = t.id AND bi.status <> 'cancelado'
      );
    GET DIAGNOSTICS v_n_ts = ROW_COUNT;
  END IF;

  -- Despesa apagada: mesma regra de competência. Status fica o que o apagar
  -- deixou (em_lancamento quando o item foi cancelado). Despesa de lote que
  -- entrou em validação/fechou depois não volta: mudaria o saldo acertado.
  IF COALESCE(cardinality(p_despesas), 0) > 0 THEN
    UPDATE operations.despesas d
    SET apagado_em = NULL,
        apagado_por = NULL,
        periodo_faturamento = GREATEST(v_mes, COALESCE(d.periodo_faturamento, d.data_lancamento::date)),
        updated_at = now(),
        updated_by = p_user_id
    WHERE d.tenant_id = v_tenant_id
      AND d.id = ANY(p_despesas)
      AND d.apagado_em >= v_limite
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'despesa'
          AND bi.origem_id = d.id AND bi.status <> 'cancelado'
      )
      AND NOT EXISTS (
        SELECT 1 FROM operations.despesa_lotes l
        WHERE l.id = d.lote_id AND l.status IN ('em_validacao', 'fechado')
      );
    GET DIAGNOSTICS v_n_desp = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'afetados', v_n_exc + v_n_ts + v_n_desp,
    'ignorados', GREATEST(v_pedidos - (v_n_exc + v_n_ts + v_n_desp), 0),
    'excluidos', v_n_exc,
    'timesheets', v_n_ts,
    'despesas', v_n_desp,
    'mes_corrente', v_mes
  );
END;
$function$;

-- Sem anon: com auth.uid() nulo a função confiaria no p_user_id recebido.
REVOKE ALL ON FUNCTION public.restaurar_lixeira_faturamento(uuid, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurar_lixeira_faturamento(uuid, uuid[], uuid[], uuid[]) TO authenticated, service_role;
-- Mesmo motivo para as da etapa 1, que ficaram com EXECUTE para PUBLIC.
REVOKE EXECUTE ON FUNCTION public.get_lixeira_faturamento(uuid, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restaurar_timesheets_lixeira(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lixeira_faturamento(uuid, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restaurar_timesheets_lixeira(uuid, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Filtro apagado_em IS NULL nas definições de produção (21/10/2026).
-- ---------------------------------------------------------------------

-- public.get_timesheets — lista da tela Timesheet
CREATE OR REPLACE FUNCTION public.get_timesheets(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
  v_is_admin_socio boolean := false;
  v_eh_coord boolean := false;
  v_is_gestor boolean := false;
  v_has_manage_perm boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_is_admin_socio := public.is_admin_or_socio(p_user_id, v_tenant_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'operations.timesheet.manage',
      'operations.timesheet.*',
      'operations.*',
      '*'
    )
  ) INTO v_has_manage_perm;

  SELECT col.area_id, a.nome, COALESCE(col.eh_coordenador, false)
  INTO v_viewer_area_id, v_viewer_area_nome, v_eh_coord
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Gestor = sócio/admin OU coordenador de área (vê a própria área).
  v_is_gestor := v_is_admin_socio OR v_eh_coord;

  -- Vê tudo só quem tem permissão explícita de gestão OU é diretor
  -- (centro de custo 'VLMA' ou sem área específica). Sócio/coordenador de
  -- área específica NÃO vê tudo — fica escopado à sua área.
  v_can_view_all := v_has_manage_perm
    OR (v_is_admin_socio AND (v_viewer_area_id IS NULL OR v_viewer_area_nome = 'VLMA'));

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'contrato_id', t.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_nome', ct.nome_contrato,
        'caso_id', t.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'data_lancamento', t.data_lancamento,
        'horas', t.horas,
        'duracao_minutos', t.duracao_minutos,
        'descricao', t.descricao,
        'status', t.status,
        'ia_auxiliado', t.ia_auxiliado,
        'ia_minutos', t.ia_minutos,
        'created_by', t.created_by,
        'created_by_nome', cb.nome,
        -- Fonte única: a mesma função que o backend usa para autorizar. Evita
        -- a tela oferecer um lápis que o servidor vai recusar.
        'pode_editar', public.pode_editar_timesheet_de(p_user_id, t.created_by),
        'revisado_por', t.revisado_por,
        'aprovado_por', t.aprovado_por,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      )
      ORDER BY t.data_lancamento DESC, t.created_at DESC
    )
    FROM operations.timesheets t
    JOIN contracts.contratos ct ON ct.id = t.contrato_id
    JOIN contracts.casos cs ON cs.id = t.caso_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = t.created_by AND cb.tenant_id = t.tenant_id
    WHERE t.tenant_id = v_tenant_id
      AND t.apagado_em IS NULL
      AND (
        v_can_view_all
        OR t.created_by = p_user_id
        OR (
          -- gestor de área específica vê as horas das pessoas do seu centro de custo
          v_is_gestor
          AND v_viewer_area_id IS NOT NULL
          AND cb.area_id = v_viewer_area_id
        )
      )
      AND (
        NULLIF(p_filters->>'contrato_id', '') IS NULL
        OR t.contrato_id = (p_filters->>'contrato_id')::uuid
      )
      AND (
        NULLIF(p_filters->>'caso_id', '') IS NULL
        OR t.caso_id = (p_filters->>'caso_id')::uuid
      )
      AND (
        NULLIF(p_filters->>'status', '') IS NULL
        OR t.status = (p_filters->>'status')
      )
      AND (
        NULLIF(p_filters->>'data_inicio', '') IS NULL
        OR t.data_lancamento >= (p_filters->>'data_inicio')::date
      )
      AND (
        NULLIF(p_filters->>'data_fim', '') IS NULL
        OR t.data_lancamento <= (p_filters->>'data_fim')::date
      )
  ), '[]'::jsonb);
END;
$function$;

-- public.get_minhas_horas_resumo — cards Minhas horas
CREATE OR REPLACE FUNCTION public.get_minhas_horas_resumo(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'contracts', 'crm', 'core', 'people'
AS $function$
DECLARE
  v_tenant uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_dias_uteis int;
BEGIN
  -- Segurança (insider): em chamada autenticada, usa sempre a identidade do token.
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Dias úteis (seg-sex) decorridos no mês, incluindo hoje.
  SELECT count(*) INTO v_dias_uteis
  FROM generate_series(v_month_start, v_today, interval '1 day') g(d)
  WHERE extract(isodow FROM g.d) < 6;
  IF v_dias_uteis IS NULL OR v_dias_uteis < 1 THEN v_dias_uteis := 1; END IF;

  RETURN (
    WITH ts AS (
      SELECT
        t.data_lancamento AS d,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h,
        COALESCE(t.duracao_minutos, round(COALESCE(t.horas, 0) * 60))::int AS mi,
        COALESCE(t.horas_aprovadas, 0) AS ha,
        cli.nome AS cliente_nome,
        (cs.numero::text || ' — ' || cs.nome) AS caso_label
      FROM operations.timesheets t
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = t.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant AND t.created_by = p_user_id AND t.apagado_em IS NULL
    )
    SELECT jsonb_build_object(
      'perfil', (
        SELECT jsonb_build_object('nome', c.nome, 'foto_url', c.foto_url)
        FROM people.colaboradores c
        WHERE c.tenant_id = v_tenant AND c.user_id = p_user_id
        ORDER BY c.ativo DESC NULLS LAST, c.created_at DESC
        LIMIT 1
      ),
      'hoje', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d = v_today),
      'semana', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d >= v_week_start AND d <= v_today),
      'mes', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d >= v_month_start),
      'mes_aprovadas', (SELECT COALESCE(round(sum(ha)::numeric, 2), 0) FROM ts WHERE d >= v_month_start),
      'hoje_min', (SELECT COALESCE(sum(mi), 0) FROM ts WHERE d = v_today),
      'semana_min', (SELECT COALESCE(sum(mi), 0) FROM ts WHERE d >= v_week_start AND d <= v_today),
      'mes_min', (SELECT COALESCE(sum(mi), 0) FROM ts WHERE d >= v_month_start),
      'mes_aprovadas_min', (SELECT COALESCE(round(sum(ha) * 60), 0) FROM ts WHERE d >= v_month_start),
      'media_dia_util_min', (SELECT COALESCE(round(sum(mi)::numeric / v_dias_uteis), 0) FROM ts WHERE d >= v_month_start),
      'top_cliente', (
        SELECT cliente_nome FROM ts WHERE d >= v_month_start AND cliente_nome IS NOT NULL
        GROUP BY cliente_nome ORDER BY sum(mi) DESC LIMIT 1
      ),
      'serie_dia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('d', to_char(dd, 'YYYY-MM-DD'), 'min', mm) ORDER BY dd)
        FROM (SELECT d AS dd, sum(mi) AS mm FROM ts WHERE d >= v_month_start GROUP BY d) s
      ), '[]'::jsonb),
      'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cliente_nome,'Sem cliente'), 'horas', round(h::numeric,2), 'minutos', mi) ORDER BY mi DESC)
                               FROM (SELECT cliente_nome, sum(h) h, sum(mi) mi FROM ts WHERE d >= v_month_start GROUP BY 1) s), '[]'::jsonb),
      'por_caso', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(caso_label,'Sem caso'), 'horas', round(h::numeric,2), 'minutos', mi) ORDER BY mi DESC)
                            FROM (SELECT caso_label, sum(h) h, sum(mi) mi FROM ts WHERE d >= v_month_start GROUP BY 1) s), '[]'::jsonb)
    )
  );
END;
$function$;

-- public.get_gestao_horas — painel do gestor
CREATE OR REPLACE FUNCTION public.get_gestao_horas(p_user_id uuid, p_ref_month date DEFAULT NULL::date, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_area_id uuid;
  v_categoria text;
  v_eh_coord boolean;
  v_is_socio boolean;
  v_is_gestor boolean;
  v_firm_wide boolean;
  v_ms date := date_trunc('month', COALESCE(p_ref_month, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  v_me date := (date_trunc('month', COALESCE(p_ref_month, (now() AT TIME ZONE 'America/Sao_Paulo')::date)) + interval '1 month')::date;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT area_id, categoria::text, eh_coordenador
  INTO v_area_id, v_categoria, v_eh_coord
  FROM people.colaboradores WHERE user_id = p_user_id AND tenant_id = v_tenant_id LIMIT 1;

  v_is_socio := COALESCE(v_categoria = 'socio', false) OR COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  v_is_gestor := v_is_socio OR COALESCE(v_eh_coord, false);
  -- sócio/admin sem área => visão do escritório inteiro
  v_firm_wide := v_is_socio AND v_area_id IS NULL;

  -- não-gestor, ou coordenador sem área (misconfig): esconde
  IF NOT v_is_gestor OR (v_area_id IS NULL AND NOT v_firm_wide) THEN
    RETURN jsonb_build_object('is_gestor', false);
  END IF;

  RETURN (
    WITH equipe AS (
      SELECT c.id, c.user_id, c.nome
      FROM people.colaboradores c
      WHERE c.tenant_id = v_tenant_id AND c.ativo
        AND (v_firm_wide OR c.area_id = v_area_id)
    ),
    ts AS (
      SELECT
        t.created_by,
        eq.nome AS pessoa_nome,
        cli.nome AS cliente_nome,
        (cs.numero::text || ' — ' || cs.nome) AS caso_label,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h_lancadas,
        COALESCE(t.horas_aprovadas, 0) AS h_aprovadas,
        -- Passa a usar o resolver: com tabela de preço por cargo, o valor
        -- depende de QUEM lançou. Antes lia só o valor avulso do caso, e os 7
        -- casos por senioridade apareciam a R$ 0,00 neste painel.
        COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) AS valor_hora
      FROM operations.timesheets t
      JOIN equipe eq ON eq.user_id = t.created_by
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = t.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id AND t.apagado_em IS NULL
        AND t.data_lancamento >= v_ms AND t.data_lancamento < v_me
        AND (p_cliente_id IS NULL OR ct.cliente_id = p_cliente_id)
    )
    SELECT jsonb_build_object(
      'is_gestor', true,
      'firm_wide', v_firm_wide,
      'area_id', v_area_id,
      'area_nome', CASE WHEN v_firm_wide THEN 'Escritório (todas as áreas)' ELSE (SELECT nome FROM people.areas WHERE id = v_area_id) END,
      'equipe_count', (SELECT count(*) FROM equipe),
      'minhas', (SELECT jsonb_build_object(
          'horas', COALESCE(sum(h_lancadas),0), 'horas_aprovadas', COALESCE(sum(h_aprovadas),0),
          'valor_projetado', COALESCE(sum(h_lancadas*valor_hora),0), 'valor_aprovado', COALESCE(sum(h_aprovadas*valor_hora),0)
        ) FROM ts WHERE created_by = p_user_id),
      'equipe_total', (SELECT jsonb_build_object(
          'horas', COALESCE(sum(h_lancadas),0), 'horas_aprovadas', COALESCE(sum(h_aprovadas),0),
          'valor_projetado', COALESCE(sum(h_lancadas*valor_hora),0), 'valor_aprovado', COALESCE(sum(h_aprovadas*valor_hora),0)
        ) FROM ts),
      'por_pessoa', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'label', pessoa_nome, 'horas', h, 'horas_aprovadas', ha, 'valor_projetado', vp, 'valor_aprovado', va
        ) ORDER BY h DESC) FROM (
          SELECT pessoa_nome, sum(h_lancadas) h, sum(h_aprovadas) ha, sum(h_lancadas*valor_hora) vp, sum(h_aprovadas*valor_hora) va
          FROM ts GROUP BY pessoa_nome) s), '[]'::jsonb),
      'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'label', COALESCE(cliente_nome,'Sem cliente'), 'horas', h, 'horas_aprovadas', ha, 'valor_projetado', vp, 'valor_aprovado', va
        ) ORDER BY h DESC) FROM (
          SELECT cliente_nome, sum(h_lancadas) h, sum(h_aprovadas) ha, sum(h_lancadas*valor_hora) vp, sum(h_aprovadas*valor_hora) va
          FROM ts GROUP BY cliente_nome) s), '[]'::jsonb),
      'por_caso', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'label', COALESCE(caso_label,'Sem caso'), 'horas', h, 'horas_aprovadas', ha, 'valor_projetado', vp, 'valor_aprovado', va
        ) ORDER BY h DESC) FROM (
          SELECT caso_label, sum(h_lancadas) h, sum(h_aprovadas) ha, sum(h_lancadas*valor_hora) vp, sum(h_aprovadas*valor_hora) va
          FROM ts GROUP BY caso_label) s), '[]'::jsonb),
      'clientes', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', ct.cliente_id, 'nome', cli.nome))
          FROM operations.timesheets t
          JOIN people.colaboradores eq ON eq.user_id = t.created_by AND eq.tenant_id = v_tenant_id AND (v_firm_wide OR eq.area_id = v_area_id)
          JOIN contracts.contratos ct ON ct.id = t.contrato_id
          JOIN crm.clientes cli ON cli.id = ct.cliente_id
          WHERE t.tenant_id = v_tenant_id AND t.apagado_em IS NULL), '[]'::jsonb)
    )
  );
END;
$function$;

-- public.get_gestao_geral — gestão geral
CREATE OR REPLACE FUNCTION public.get_gestao_geral(p_user_id uuid, p_ref_month date DEFAULT NULL::date, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'people', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_categoria text;
  v_ini date;
  v_fim date;
  v_area_f uuid := NULLIF(p_filters->>'area_id', '')::uuid;
  v_pessoa_f uuid := NULLIF(p_filters->>'pessoa_user_id', '')::uuid;
  v_cliente_f uuid := NULLIF(p_filters->>'cliente_id', '')::uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  SELECT c.categoria::text INTO v_categoria
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
  LIMIT 1;

  IF NOT (v_categoria = 'socio'
          OR public.tem_capacidade_sensivel(p_user_id, 'operations.gestao_geral')) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  v_ini := date_trunc('month', COALESCE(p_ref_month, now()::date))::date;
  v_fim := (v_ini + interval '1 month' - interval '1 day')::date;

  RETURN (
    WITH pessoas AS (
      SELECT c.id, c.user_id, c.nome, c.area_id, a.nome AS area_nome
      FROM people.colaboradores c
      LEFT JOIN people.areas a ON a.id = c.area_id AND a.tenant_id = v_tenant_id
      WHERE c.tenant_id = v_tenant_id AND c.ativo AND c.user_id IS NOT NULL
        AND (v_area_f IS NULL OR c.area_id = v_area_f)
        AND (v_pessoa_f IS NULL OR c.user_id = v_pessoa_f)
    ),
    ts AS (
      SELECT
        t.created_by,
        p.nome AS pessoa_nome,
        p.area_id,
        p.area_nome,
        cli.id  AS cliente_id,
        cli.nome AS cliente_nome,
        (cs.numero::text || ' — ' || cs.nome) AS caso_label,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h_lancadas,
        COALESCE(t.horas_aprovadas, 0) AS h_aprovadas,
        COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) AS valor_hora
      FROM operations.timesheets t
      JOIN pessoas p ON p.user_id = t.created_by
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = t.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id AND t.apagado_em IS NULL
        AND t.data_lancamento BETWEEN v_ini AND v_fim
        AND (v_cliente_f IS NULL OR cli.id = v_cliente_f)
    )
    SELECT jsonb_build_object(
      'autorizado', true,
      'periodo', jsonb_build_object('inicio', v_ini, 'fim', v_fim),
      'totais', (
        SELECT jsonb_build_object(
          'pessoas', (SELECT count(*) FROM pessoas),
          'pessoas_com_lancamento', count(DISTINCT created_by),
          'horas', COALESCE(sum(h_lancadas), 0),
          'horas_aprovadas', COALESCE(sum(h_aprovadas), 0),
          'valor_projetado', COALESCE(sum(h_lancadas * valor_hora), 0),
          'valor_aprovado', COALESCE(sum(h_aprovadas * valor_hora), 0)
        ) FROM ts
      ),
      -- Série diária para o gráfico de barras (mesmo layout da tela do usuário).
      'serie_dia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('d', s.dia, 'min', s.minutos) ORDER BY s.dia)
        FROM (
          SELECT t.data_lancamento AS dia,
                 sum(COALESCE(t.duracao_minutos, t.horas * 60, 0)) AS minutos
          FROM operations.timesheets t
          JOIN pessoas p ON p.user_id = t.created_by
          WHERE t.tenant_id = v_tenant_id AND t.apagado_em IS NULL
            AND t.data_lancamento BETWEEN v_ini AND v_fim
          GROUP BY t.data_lancamento
        ) s
      ), '[]'::jsonb),
      'por_area', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'area_id', s.area_id, 'label', s.label, 'pessoas', s.pessoas,
          'horas', s.h, 'valor_projetado', s.vp, 'valor_aprovado', s.va
        ) ORDER BY s.h DESC)
        FROM (
          SELECT p.area_id, COALESCE(p.area_nome, 'Sem centro de custo') AS label,
                 count(DISTINCT p.user_id) AS pessoas,
                 COALESCE(sum(t.h_lancadas), 0) AS h,
                 COALESCE(sum(t.h_lancadas * t.valor_hora), 0) AS vp,
                 COALESCE(sum(t.h_aprovadas * t.valor_hora), 0) AS va
          FROM pessoas p
          LEFT JOIN ts t ON t.created_by = p.user_id
          GROUP BY p.area_id, p.area_nome
        ) s
      ), '[]'::jsonb),
      'por_pessoa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', s.user_id, 'label', s.nome, 'area', s.area_nome,
          'horas', s.h, 'valor_projetado', s.vp, 'valor_aprovado', s.va
        ) ORDER BY s.h DESC, s.nome)
        FROM (
          SELECT p.user_id, p.nome, p.area_nome,
                 COALESCE(sum(t.h_lancadas), 0) AS h,
                 COALESCE(sum(t.h_lancadas * t.valor_hora), 0) AS vp,
                 COALESCE(sum(t.h_aprovadas * t.valor_hora), 0) AS va
          FROM pessoas p
          LEFT JOIN ts t ON t.created_by = p.user_id
          GROUP BY p.user_id, p.nome, p.area_nome
        ) s
      ), '[]'::jsonb),
      'por_cliente', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('label', s.cliente_nome, 'horas', s.h, 'valor_projetado', s.vp) ORDER BY s.h DESC)
        FROM (
          SELECT cliente_nome, sum(h_lancadas) AS h, sum(h_lancadas * valor_hora) AS vp
          FROM ts WHERE cliente_nome IS NOT NULL
          GROUP BY cliente_nome ORDER BY sum(h_lancadas) DESC LIMIT 15
        ) s
      ), '[]'::jsonb),
      'por_caso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('label', s.caso_label, 'horas', s.h, 'valor_projetado', s.vp) ORDER BY s.h DESC)
        FROM (
          SELECT caso_label, sum(h_lancadas) AS h, sum(h_lancadas * valor_hora) AS vp
          FROM ts WHERE caso_label IS NOT NULL
          GROUP BY caso_label ORDER BY sum(h_lancadas) DESC LIMIT 15
        ) s
      ), '[]'::jsonb),
      'filtros', jsonb_build_object(
        'areas', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome) ORDER BY a.nome)
          FROM people.areas a WHERE a.tenant_id = v_tenant_id
        ), '[]'::jsonb),
        'pessoas', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('user_id', c.user_id, 'nome', c.nome) ORDER BY c.nome)
          FROM people.colaboradores c
          WHERE c.tenant_id = v_tenant_id AND c.ativo AND c.user_id IS NOT NULL
        ), '[]'::jsonb)
      )
    )
  );
END;
$function$;

-- public.get_indicadores_faturamento — horas lançadas do indicador
CREATE OR REPLACE FUNCTION public.get_indicadores_faturamento(p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_inicio date;
  v_fim date;
  v_can_view_all boolean := false;
  v_area uuid;
  v_area_nome text;
  v_resumo jsonb;
  v_clientes jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM core.tenant_users tu
  WHERE tu.user_id = v_user AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(v_user) p
    WHERE p.permission_key IN (
      'finance.faturamento.read', 'finance.faturamento.review', 'finance.faturamento.approve',
      'finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar indicadores';
  END IF;

  v_inicio := COALESCE(p_data_inicio, date_trunc('month', CURRENT_DATE)::date);
  v_fim := COALESCE(p_data_fim, (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date);

  SELECT col.area_id, a.nome INTO v_area, v_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
  WHERE col.user_id = v_user AND col.tenant_id = v_tenant
  LIMIT 1;

  v_can_view_all :=
    EXISTS (SELECT 1 FROM public.get_user_permissions(v_user) p WHERE p.permission_key = '*')
    OR v_area IS NULL
    OR v_area_nome IN ('VLMA', 'Financeiro');

  WITH ts AS (
    -- etapa 1: tudo que foi LANÇADO no período (independe de envio)
    SELECT t.horas, autor.area_id AS autor_area
    FROM operations.timesheets t
    LEFT JOIN people.colaboradores autor ON autor.user_id = t.created_by AND autor.tenant_id = v_tenant
    WHERE t.tenant_id = v_tenant
      AND t.apagado_em IS NULL
      -- Mesma competencia dos itens: hora trabalhada em X e faturada em X+1
      -- (periodo_faturamento, PR #360). Antes contava data_lancamento no mes
      -- corrente e o card mostrava 460h contra 3.106h enviadas ("674% das
      -- lancadas") — setembro trabalhado contra agosto faturado.
      AND COALESCE(t.periodo_faturamento, t.data_lancamento::date) BETWEEN v_inicio AND v_fim
      AND (v_can_view_all OR autor.area_id = v_area OR t.created_by = v_user)
  ),
  bi AS (
    SELECT
      bi.*,
      cli.nome AS cliente_nome,
      ts_colab.area_id AS autor_area
    FROM finance.billing_items bi
    JOIN crm.clientes cli ON cli.id = bi.cliente_id AND cli.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t ON bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab ON ts_colab.user_id = t.created_by AND ts_colab.tenant_id = bi.tenant_id
    WHERE bi.tenant_id = v_tenant
      AND bi.status NOT IN ('disponivel', 'cancelado')
      AND bi.periodo_inicio >= v_inicio
      AND bi.periodo_fim <= v_fim
      AND (v_can_view_all OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_area))
  )
  SELECT jsonb_build_object(
    'periodo_inicio', v_inicio,
    'periodo_fim', v_fim,
    'horas_lancadas', COALESCE((SELECT sum(horas) FROM ts), 0),
    'horas_enviadas', COALESCE((SELECT sum(horas_informadas) FROM bi WHERE origem_tipo = 'timesheet'), 0),
    'horas_revisadas', COALESCE((SELECT sum(COALESCE(horas_revisadas, horas_informadas)) FROM bi WHERE origem_tipo = 'timesheet' AND status IN ('em_aprovacao', 'aprovado', 'faturado')), 0),
    'horas_aprovadas', COALESCE((SELECT sum(COALESCE(horas_aprovadas, horas_revisadas, horas_informadas)) FROM bi WHERE origem_tipo = 'timesheet' AND status IN ('aprovado', 'faturado')), 0),
    'horas_ignoradas', COALESCE((SELECT sum(horas_informadas) FROM bi WHERE origem_tipo = 'timesheet' AND status = 'ignorado'), 0),
    'itens_ignorados', COALESCE((SELECT count(*) FROM bi WHERE status = 'ignorado'), 0),
    'valor_ignorado', COALESCE((SELECT sum(COALESCE(valor_informado, 0)) FROM bi WHERE status = 'ignorado'), 0),
    'ignorados_por_motivo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'quantidade', qtd, 'horas', horas))
      FROM (
        SELECT COALESCE(NULLIF(snapshot->>'motivo_ignorado', ''), 'Sem justificativa') AS motivo,
               count(*) AS qtd, sum(horas_informadas) AS horas
        FROM bi WHERE status = 'ignorado'
        GROUP BY 1 ORDER BY 2 DESC
      ) m
    ), '[]'::jsonb)
  ) INTO v_resumo;

  WITH bi AS (
    SELECT
      bi.*,
      cli.nome AS cliente_nome,
      ts_colab.area_id AS autor_area
    FROM finance.billing_items bi
    JOIN crm.clientes cli ON cli.id = bi.cliente_id AND cli.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t ON bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab ON ts_colab.user_id = t.created_by AND ts_colab.tenant_id = bi.tenant_id
    WHERE bi.tenant_id = v_tenant
      AND bi.status NOT IN ('disponivel', 'cancelado')
      AND bi.periodo_inicio >= v_inicio
      AND bi.periodo_fim <= v_fim
      AND (v_can_view_all OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_area))
  )
  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'projecao_valor')::numeric DESC), '[]'::jsonb)
  INTO v_clientes
  FROM (
    SELECT jsonb_build_object(
      'cliente', cliente_nome,
      'casos', count(DISTINCT caso_id),
      'horas_enviadas', COALESCE(sum(horas_informadas) FILTER (WHERE origem_tipo = 'timesheet'), 0),
      'horas_revisadas', COALESCE(sum(COALESCE(horas_revisadas, horas_informadas)) FILTER (WHERE origem_tipo = 'timesheet' AND status IN ('em_aprovacao', 'aprovado', 'faturado')), 0),
      'horas_aprovadas', COALESCE(sum(COALESCE(horas_aprovadas, horas_revisadas, horas_informadas)) FILTER (WHERE origem_tipo = 'timesheet' AND status IN ('aprovado', 'faturado')), 0),
      'horas_ignoradas', COALESCE(sum(horas_informadas) FILTER (WHERE status = 'ignorado'), 0),
      'projecao_valor', COALESCE(sum(COALESCE(valor_aprovado, valor_revisado, valor_informado, 0)) FILTER (WHERE status <> 'ignorado'), 0)
    ) AS linha
    FROM bi
    GROUP BY cliente_nome
  ) sub;

  RETURN jsonb_build_object('resumo', v_resumo, 'por_cliente', v_clientes);
END;
$function$;

-- public.get_itens_a_faturar — fila de faturar (horas)
CREATE OR REPLACE FUNCTION public.get_itens_a_faturar(p_user_id uuid, p_data_inicio date, p_data_fim date, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF p_data_inicio IS NULL OR p_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;

  IF p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;

  RETURN (
    WITH base_timesheet AS (
      SELECT
        t.id AS origem_id,
        t.data_lancamento::date AS data_referencia,
        t.horas::numeric(12,2) AS horas,
        (
          -- Caso com regra MENSAL (ou mensalidade de processo / carteira /
          -- salario minimo) ja cobra pelo periodo: a hora entra pelo registro,
          -- valendo zero. Antes ela era valorizada pela tabela de preco mesmo
          -- assim, e o caso cobrava as duas coisas — Filipe, 03/09, caso 319:
          -- mensalidade de R$ 25.000 somando com R$ 116.921,80 de horas.
          --
          -- 'cobra_excedente' = true e a excecao deliberada: o combinado inclui
          -- N horas e o que passar disso se cobra. Ai a hora volta a valer.
          CASE
            WHEN COALESCE(NULLIF(rg.regra, ''), '') IN
                 ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
             AND COALESCE((rg.cfg->>'cobra_excedente')::boolean, false) = false
            THEN 0
            ELSE COALESCE(t.horas, 0) * COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
          END
        )::numeric(14,2) AS valor,
        c.id AS contrato_id,
        c.numero AS contrato_numero,
        c.numero_sequencial AS contrato_numero_sequencial,
        c.nome_contrato,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        'timesheet'::text AS item_tipo,
        -- aba Horas só quando o caso cobra por hora; sem regra => sem aba (Todas)
        (CASE
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
            ) r
            WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
              AND NULLIF(r->>'regra_cobranca','') IN ('hora','hora_com_cap')
          ) OR NULLIF(cs.regra_cobranca,'') IN ('hora','hora_com_cap') THEN 'hora'
          ELSE COALESCE(
            (
              SELECT NULLIF(r->>'regra_cobranca','') FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
              ) r
              WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
                AND NULLIF(r->>'regra_cobranca','') IS NOT NULL
              LIMIT 1
            ),
            NULLIF(cs.regra_cobranca, '')
          )
        END)::text AS caso_regra,
        COALESCE(NULLIF(t.descricao, ''), 'Timesheet - ' || to_char(t.data_lancamento::date, 'DD/MM/YYYY'))::text AS descricao,
        COALESCE(aut.nome, '')::text AS lancado_por
      FROM operations.timesheets t
      LEFT JOIN people.colaboradores aut ON aut.user_id = t.created_by AND aut.tenant_id = v_tenant_id
      JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
      -- Regra vigente do caso, para saber se a hora e cobravel. Precisa vir
      -- DEPOIS do join de casos: LATERAL so enxerga o que ja esta no FROM.
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(NULLIF(r0.x->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra,
          COALESCE(r0.x->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb) AS cfg
        FROM (
          SELECT CASE
            WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
             AND jsonb_array_length(cs.regras_financeiras) > 0
            THEN cs.regras_financeiras->0
            ELSE '{}'::jsonb END AS x
        ) r0
      ) rg
      WHERE t.tenant_id = v_tenant_id
        -- Periodo efetivo: data do trabalho, a menos que tenha sido postergado
        -- para outro mes (postergar_timesheet) — ai vale a data escolhida.
        AND COALESCE(t.periodo_faturamento, t.data_lancamento::date) BETWEEN p_data_inicio AND p_data_fim
        AND c.status = 'ativo'
        AND cs.status <> 'inativo'
        AND NOT t.excluido_faturamento
        AND t.apagado_em IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM finance.billing_items bi
          WHERE bi.tenant_id = v_tenant_id
            AND bi.origem_tipo = 'timesheet'
            AND bi.origem_id = t.id
            AND bi.status <> 'cancelado'
        )
        AND (
          p_search IS NULL
          OR trim(p_search) = ''
          OR cli.nome ILIKE '%' || trim(p_search) || '%'
          OR c.nome_contrato ILIKE '%' || trim(p_search) || '%'
          OR cs.nome ILIKE '%' || trim(p_search) || '%'
          OR c.numero::text ILIKE '%' || trim(p_search) || '%'
          OR cs.numero::text ILIKE '%' || trim(p_search) || '%'
        )
    ),
    rules_source AS (
      SELECT
        c.id AS contrato_id,
        c.numero AS contrato_numero,
        c.numero_sequencial AS contrato_numero_sequencial,
        c.nome_contrato,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        cs.parte_de_carteira_id,
        COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
        COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
        COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
        z.dia_inicio_faturamento,
        z.data_inicio_faturamento,
        COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status,
        finance.rule_origin_uuid(cs.id, COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text)) AS origem_regra_id
      FROM contracts.casos cs
      JOIN contracts.contratos c ON c.id = cs.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      CROSS JOIN LATERAL (
        SELECT x AS rule_item
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
              THEN cs.regras_financeiras
            ELSE jsonb_build_array(
              jsonb_build_object(
                'id', 'legacy-' || cs.id::text,
                'status', cs.status,
                'regra_cobranca', cs.regra_cobranca,
                'data_inicio_faturamento', cs.data_inicio_faturamento,
                'dia_inicio_faturamento', cs.dia_inicio_faturamento,
                'regra_cobranca_config', COALESCE(cs.regra_cobranca_config, '{}'::jsonb)
              )
            )
          END
        ) AS x
      ) r
      CROSS JOIN LATERAL public.z6_resolve_inicio_faturamento(
        r.rule_item,
        cs.data_inicio_faturamento,
        cs.dia_inicio_faturamento,
        c.created_at::date,
        p_data_inicio
      ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
      WHERE cs.tenant_id = v_tenant_id
        AND c.status = 'ativo'
        AND cs.status = 'ativo'
        AND (
          p_search IS NULL
          OR trim(p_search) = ''
          OR cli.nome ILIKE '%' || trim(p_search) || '%'
          OR c.nome_contrato ILIKE '%' || trim(p_search) || '%'
          OR cs.nome ILIKE '%' || trim(p_search) || '%'
          OR c.numero::text ILIKE '%' || trim(p_search) || '%'
          OR cs.numero::text ILIKE '%' || trim(p_search) || '%'
        )
    ),
    regra_mensal_itens AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':mensal:' || to_char(gs.ref_mes, 'YYYYMM')) AS origem_id,
        rs.origem_regra_id,
        gs.ref_mes::date AS data_referencia,
        0::numeric(12,2) AS horas,
        val.valor::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        -- salário mínimo é apresentado como "Mensalidade de processo" no app (form),
        -- então cai na mesma aba da grid.
        CASE
          WHEN rs.regra_cobranca = 'salario_minimo' THEN 'mensalidade_processo'
          WHEN rs.regra_cobranca = 'mensalidade_carteira' THEN 'mensal'
          ELSE rs.regra_cobranca
        END AS item_tipo,
        (
          CASE
            WHEN rs.regra_cobranca IN ('mensalidade_processo', 'salario_minimo') THEN 'Mensalidade de processo'
            WHEN rs.regra_cobranca = 'mensalidade_carteira' THEN 'Mensalidade de carteira'
            ELSE 'Mensalidade'
          END
          || ' - ' || to_char(gs.ref_mes, 'MM/YYYY')
        )::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      JOIN LATERAL (
        SELECT generate_series(
          date_trunc('month', GREATEST(rs.data_inicio_faturamento, p_data_inicio))::date,
          date_trunc('month', p_data_fim)::date,
          interval '1 month'
        )::date AS ref_mes
      ) gs ON true
      CROSS JOIN LATERAL (
        SELECT (
          CASE
            WHEN rs.regra_cobranca = 'salario_minimo' THEN
              COALESCE(NULLIF(rs.cfg->>'quantidade_sm', '')::numeric, 0)
              * COALESCE(
                  (SELECT sm.valor FROM config.salario_minimo sm
                    WHERE sm.tenant_id = v_tenant_id AND sm.vigencia_desde <= gs.ref_mes
                    ORDER BY sm.vigencia_desde DESC LIMIT 1),
                  (SELECT sm.valor FROM config.salario_minimo sm
                    WHERE sm.tenant_id = v_tenant_id
                    ORDER BY sm.vigencia_desde DESC LIMIT 1),
                  0
                )
            WHEN rs.regra_cobranca = 'mensalidade_carteira' THEN
              COALESCE(NULLIF(rs.cfg->>'valor_mensal_carteira', '')::numeric, 0)
            ELSE COALESCE(NULLIF(rs.cfg->>'valor_mensal', '')::numeric, 0)
          END
        ) AS valor
      ) val
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('mensal', 'mensalidade_processo', 'salario_minimo', 'mensalidade_carteira')
        -- Só a matriz da carteira fatura; os processos dentro dela já estão no
        -- valor dela. Mesma trava que start_faturamento_flow sempre teve — sem
        -- ela, o dia em que alguém montar uma carteira com filhos a fila cobra
        -- duas vezes.
        AND (rs.regra_cobranca <> 'mensalidade_carteira' OR rs.parte_de_carteira_id IS NULL)
        AND val.valor > 0
        -- A trava do "so entra depois do dia X do mes corrente" saiu daqui.
        -- Filipe, 01/09: "cobra-se as horas no comeco do mes corrente" e
        -- "quero cobrar as mensalidades de setembro no comeco do mes". Com ela,
        -- gerar no dia 1o trazia ZERO mensalidade — o dia cadastrado no caso
        -- ainda nao tinha chegado.
    ),
    regra_projeto_parcelas AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':parcela:' || p.ord::text) AS origem_id,
        rs.origem_regra_id,
        NULLIF(p.item->>'data_pagamento', '')::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(NULLIF(p.item->>'valor', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'projeto_parcela'::text AS item_tipo,
        ('Projeto - Parcela ' || p.ord::text)::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      CROSS JOIN LATERAL jsonb_array_elements(rs.cfg->'parcelas') WITH ORDINALITY AS p(item, ord)
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('projeto', 'pro_labore')
        AND jsonb_typeof(rs.cfg->'parcelas') = 'array'
        AND jsonb_array_length(rs.cfg->'parcelas') > 0
        AND NULLIF(p.item->>'data_pagamento', '')::date BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(NULLIF(p.item->>'valor', '')::numeric, 0) > 0
    ),
    regra_projeto_unico AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':projeto_unico') AS origem_id,
        rs.origem_regra_id,
        rs.data_inicio_faturamento::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(NULLIF(rs.cfg->>'valor_projeto', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'projeto'::text AS item_tipo,
        'Projeto - Valor único'::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('projeto', 'pro_labore')
        AND (
          jsonb_typeof(rs.cfg->'parcelas') <> 'array'
          OR jsonb_array_length(rs.cfg->'parcelas') = 0
        )
        AND rs.data_inicio_faturamento BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(NULLIF(rs.cfg->>'valor_projeto', '')::numeric, 0) > 0
    ),
    regra_exito AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':exito') AS origem_id,
        rs.origem_regra_id,
        NULLIF(rs.cfg->>'data_pagamento_exito', '')::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(
          NULLIF(rs.cfg->>'valor_exito_calculado', '')::numeric,
          (
            COALESCE(NULLIF(rs.cfg->>'valor_acao', '')::numeric, 0)
            * COALESCE(NULLIF(rs.cfg->>'percentual_exito', '')::numeric, 0)
            / 100.0
          )
        )::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'exito'::text AS item_tipo,
        'Êxito'::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'exito'
        AND NULLIF(rs.cfg->>'data_pagamento_exito', '')::date BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(
          NULLIF(rs.cfg->>'valor_exito_calculado', '')::numeric,
          (
            COALESCE(NULLIF(rs.cfg->>'valor_acao', '')::numeric, 0)
            * COALESCE(NULLIF(rs.cfg->>'percentual_exito', '')::numeric, 0)
            / 100.0
          )
        ) > 0
    ),
    -- Linhas adiadas PARA este periodo. Vem do snapshot guardado no
    -- adiamento: a regra do contrato so gera linha para o mes de competencia,
    -- entao sem o snapshot uma mensalidade de agosto adiada para outubro
    -- simplesmente nao existiria em outubro.
    regra_adiados_entrando AS (
      SELECT
        a.origem_id,
        NULL::uuid AS origem_regra_id,
        COALESCE(a.data_referencia, a.periodo_novo) AS data_referencia,
        0::numeric(12,2) AS horas,
        a.valor::numeric(14,2) AS valor,
        ct.id AS contrato_id,
        ct.numero AS contrato_numero,
        ct.numero_sequencial AS contrato_numero_sequencial,
        ct.nome_contrato,
        cl.id AS cliente_id,
        cl.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        a.item_tipo,
        (a.descricao || ' (adiado de ' || to_char(a.competencia, 'MM/YYYY') || ')')::text AS descricao,
        ''::text AS lancado_por
      FROM finance.faturamento_adiamentos a
      JOIN contracts.casos cs ON cs.id = a.caso_id
      JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE a.tenant_id = v_tenant_id
        AND a.desfeito_em IS NULL
        AND a.periodo_novo BETWEEN date_trunc('month', p_data_inicio)::date AND p_data_fim
    ),
    regra_itens_raw AS (
      SELECT * FROM regra_adiados_entrando
      UNION ALL
      SELECT * FROM regra_mensal_itens
      UNION ALL
      SELECT * FROM regra_projeto_parcelas
      UNION ALL
      SELECT * FROM regra_projeto_unico
      UNION ALL
      SELECT * FROM regra_exito
    ),
    regra_itens AS (
      SELECT r.*
      FROM regra_itens_raw r
      WHERE NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.periodo_inicio = p_data_inicio
          AND bi.periodo_fim = p_data_fim
          AND bi.status <> 'cancelado'
          AND (bi.origem_id = r.origem_id OR bi.origem_id = r.origem_regra_id)
      )
      -- Adiada para outro mes: sai da fila deste. O proprio adiamento a
      -- devolve no mes de destino, via regra_adiados_entrando.
      AND NOT EXISTS (
        SELECT 1 FROM finance.faturamento_adiamentos a
        WHERE a.tenant_id = v_tenant_id
          AND a.origem_id = r.origem_id
          AND a.desfeito_em IS NULL
          AND a.periodo_novo > date_trunc('month', p_data_inicio)::date
          AND a.competencia = date_trunc('month', p_data_inicio)::date
      )
    ),
    item_rows AS (
      SELECT
        bt.cliente_id,
        bt.cliente_nome,
        bt.contrato_id,
        bt.contrato_numero,
        bt.contrato_numero_sequencial,
        bt.nome_contrato,
        bt.caso_id,
        bt.caso_numero,
        bt.caso_nome,
        bt.origem_id,
        bt.data_referencia,
        bt.horas,
        bt.valor,
        bt.item_tipo,
        bt.caso_regra,
        bt.descricao,
        bt.lancado_por
      FROM base_timesheet bt
      UNION ALL
      SELECT
        ri.cliente_id,
        ri.cliente_nome,
        ri.contrato_id,
        ri.contrato_numero,
        ri.contrato_numero_sequencial,
        ri.nome_contrato,
        ri.caso_id,
        ri.caso_numero,
        ri.caso_nome,
        ri.origem_id,
        ri.data_referencia,
        ri.horas,
        ri.valor,
        ri.item_tipo,
        NULL::text AS caso_regra,
        ri.descricao,
        ri.lancado_por
      FROM regra_itens ri
    ),
    case_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        contrato_id,
        contrato_numero,
        contrato_numero_sequencial,
        nome_contrato,
        caso_id,
        caso_numero,
        caso_nome,
        -- Centro de custo do caso, para o filtro da barra superior (Filipe
        -- 07/08). Pega o primeiro do rateio, que e como o resto do sistema ja
        -- resolve quando precisa de um so.
        (SELECT COALESCE(ar.nome, NULLIF(rr->>'centro_custo_nome',''))
           FROM contracts.casos cs2
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(cs2.centro_custo_rateio)='array'
                  THEN cs2.centro_custo_rateio ELSE '[]'::jsonb END) rr
           LEFT JOIN people.areas ar ON ar.id = NULLIF(rr->>'centro_custo_id','')::uuid
          WHERE cs2.id = item_rows.caso_id
          LIMIT 1) AS centro_custo_nome,
        COUNT(*)::bigint AS total_itens,
        COALESCE(SUM(horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              -- origem_id faltava aqui: o front usa linha.origem_id para Postergar
              -- e Excluir (itens-a-faturar-list.tsx), e sem ele o filtro
              -- `Boolean(linha.origem_id)` nunca achava nada — os dois botoes
              -- ficavam sempre dizendo "sem lancamentos postergaveis/excluiveis".
              'origem_id', origem_id,
              'tipo', item_tipo,
              'caso_regra', caso_regra,
              'descricao', descricao,
              'lancado_por', lancado_por,
              'data_referencia', data_referencia,
              'horas', horas,
              'valor', valor
            )
            -- regra do caso primeiro (valor principal), horas embaixo p/ validação
            ORDER BY (item_tipo = 'timesheet'), data_referencia NULLS LAST, descricao
          ),
          '[]'::jsonb
        ) AS extrato
      FROM item_rows
      GROUP BY cliente_id, cliente_nome, contrato_id, contrato_numero, contrato_numero_sequencial, nome_contrato, caso_id, caso_numero, caso_nome
    ),
    contrato_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        contrato_id,
        contrato_numero,
        contrato_numero_sequencial,
        nome_contrato,
        COALESCE(SUM(total_horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(total_valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(SUM(total_itens), 0)::bigint AS total_itens,
        jsonb_agg(
          jsonb_build_object(
            'caso_id', caso_id,
            'caso_numero', caso_numero,
            'caso_nome', caso_nome,
            'centro_custo_nome', centro_custo_nome,
            'total_horas', total_horas,
            'total_valor', total_valor,
            'total_itens', total_itens,
            'extrato', extrato
          )
          ORDER BY caso_numero NULLS LAST, caso_nome
        ) AS casos
      FROM case_agg
      GROUP BY cliente_id, cliente_nome, contrato_id, contrato_numero, contrato_numero_sequencial, nome_contrato
    ),
    cliente_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        COALESCE(SUM(total_horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(total_valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(SUM(total_itens), 0)::bigint AS total_itens,
        jsonb_agg(
          jsonb_build_object(
            'contrato_id', contrato_id,
            'contrato_numero', contrato_numero,
            'contrato_numero_sequencial', contrato_numero_sequencial,
            'contrato_nome', nome_contrato,
            'total_horas', total_horas,
            'total_valor', total_valor,
            'total_itens', total_itens,
            'casos', casos
          )
          ORDER BY contrato_numero NULLS LAST, nome_contrato
        ) AS contratos
      FROM contrato_agg
      GROUP BY cliente_id, cliente_nome
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'cliente_id', cliente_id,
          'cliente_nome', cliente_nome,
          'total_horas', total_horas,
          'total_valor', total_valor,
          'total_itens', total_itens,
          'contratos', contratos
        )
        ORDER BY cliente_nome
      ),
      '[]'::jsonb
    )
    FROM cliente_agg
  );
END;
$function$;

-- public.get_fila_por_competencia — fila de faturar (despesas)
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
        AND d.apagado_em IS NULL
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

-- public.get_faturamento_postergados — postergados
CREATE OR REPLACE FUNCTION public.get_faturamento_postergados(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.periodo_novo, x.cliente_nome)
    FROM (
      -- 1. Itens de regra (mensalidade, projeto, parcela)
      SELECT a.id, 'regra'::text AS fonte, a.item_tipo, a.descricao, a.valor,
             a.competencia, a.periodo_novo, a.motivo,
             cs.numero AS caso_numero, cs.nome AS caso_nome,
             cl.nome AS cliente_nome, a.created_at
      FROM finance.faturamento_adiamentos a
      LEFT JOIN contracts.casos cs ON cs.id = a.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE a.tenant_id = v_tenant_id AND a.desfeito_em IS NULL

      UNION ALL

      -- 2. Horas adiadas — moram em outro lugar (periodo_faturamento do
      --    timesheet), mas para quem olha a tela são a mesma coisa.
      SELECT t.id, 'hora'::text, 'timesheet',
             COALESCE(NULLIF(t.descricao, ''), 'Horas') ,
             (t.horas * COALESCE(public.resolver_valor_hora(t.caso_id, t.cargo_id), 0))::numeric(14,2),
             (date_trunc('month', t.data_lancamento) + interval '1 month')::date,
             t.periodo_faturamento,
             NULL,
             cs.numero, cs.nome, cl.nome, t.updated_at
      FROM operations.timesheets t
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id
        AND t.periodo_faturamento IS NOT NULL
        AND date_trunc('month', t.periodo_faturamento)::date > (date_trunc('month', t.data_lancamento) + interval '1 month')::date
        -- periodo_faturamento veio da restauração da lixeira, não de um
        -- adiamento (o trigger limpa o marcador se alguém postergar depois).
        AND t.restaurado_da_lixeira_em IS NULL
        AND t.apagado_em IS NULL
    ) x
  ), '[]'::jsonb);
END;
$function$;

-- public.cp_receita_prevista — receita prevista
CREATE OR REPLACE FUNCTION public.cp_receita_prevista(p_user_id uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      AND t.apagado_em IS NULL
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

-- public.validar_precos_antes_de_liberar — trava de preço ao liberar
CREATE OR REPLACE FUNCTION public.validar_precos_antes_de_liberar(p_tenant_id uuid, p_caso_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'operations', 'people'
AS $function$
DECLARE
  v_msg text;
BEGIN
  SELECT string_agg(DISTINCT format('caso %s (%s)', cs.numero, COALESCE(cg.nome, 'sem cargo')), '; ')
    INTO v_msg
  FROM operations.timesheets t
  JOIN contracts.casos cs ON cs.id = t.caso_id
  LEFT JOIN people.cargos cg ON cg.id = t.cargo_id
  WHERE t.tenant_id = p_tenant_id
    AND t.apagado_em IS NULL
    AND t.caso_id = ANY(p_caso_ids)
    AND t.status = 'em_lancamento'
    AND COALESCE(t.horas, 0) > 0
    -- só cobra hora
    AND (
      COALESCE(NULLIF(cs.regra_cobranca, ''), '') IN ('hora', 'hora_com_cap')
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
               THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
        WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
          AND NULLIF(r->>'regra_cobranca', '') IN ('hora', 'hora_com_cap')
      )
    )
    AND COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) <= 0;

  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'Não dá para liberar: sem valor/hora definido para %. Cadastre o valor na regra de cobrança do caso (ou o cargo na tabela de preço) antes de liberar.', v_msg;
  END IF;
END;
$function$;

-- public.start_faturamento_flow — gerador de faturamento
CREATE OR REPLACE FUNCTION public.start_faturamento_flow(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data_inicio date;
  v_data_fim date;
  v_alvo_tipo varchar;
  v_alvo_id uuid;
  v_alvo_ids uuid[] := ARRAY[]::uuid[];
  v_search text;
  v_somente_regras boolean := false;
  v_batch_id uuid;
  v_batch_numero bigint;
  v_items_count int := 0;
  v_can_write boolean := false;
  -- 28/09: seleção de itens da fila (ver bloco alvo_chaves abaixo)
  v_sel_ts uuid[] := ARRAY[]::uuid[];
  v_sel_desp uuid[] := ARRAY[]::uuid[];
  v_sel_regra uuid[] := ARRAY[]::uuid[];
  v_filtra_itens boolean := false;
  v_msg_preco text;
  v_desp jsonb;
  v_desp_count int := 0;
  v_auto_count int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_write;
  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para iniciar fluxo de faturamento';
  END IF;
  v_data_inicio := NULLIF(p_payload->>'data_inicio', '')::date;
  v_data_fim := NULLIF(p_payload->>'data_fim', '')::date;
  v_alvo_tipo := COALESCE(NULLIF(p_payload->>'alvo_tipo', ''), 'itens');
  v_alvo_id := NULLIF(p_payload->>'alvo_id', '')::uuid;
  v_search := NULLIF(trim(COALESCE(p_payload->>'search', '')), '');
  v_somente_regras := COALESCE((p_payload->>'somente_regras')::boolean, false);
  IF jsonb_typeof(p_payload->'alvo_ids') = 'array' THEN
    SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_alvo_ids
    FROM jsonb_array_elements_text(p_payload->'alvo_ids') AS t(value)
    WHERE value IS NOT NULL
      AND value <> ''
      AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
  IF v_alvo_id IS NOT NULL THEN
    v_alvo_ids := array_append(v_alvo_ids, v_alvo_id);
  END IF;
  SELECT COALESCE(array_agg(DISTINCT entry), ARRAY[]::uuid[]) INTO v_alvo_ids
  FROM unnest(v_alvo_ids) AS entry;

  -- 28/09 (Filipe): "selecionar um a um e selecionar todos para liberar em
  -- massa". Com alvo_tipo='itens' a seleção chega por alvo_ids (origem_id da
  -- fila: timesheet.id, despesa.id ou o uuid da regra) e/ou alvo_chaves (os
  -- ids virtuais 'fila:<origem_tipo>:<origem_id>' que get_fila_por_competencia
  -- devolve). alvo_ids não diz o tipo, então vale para os três; alvo_chaves
  -- entra só no tipo que declara. Sem nenhum dos dois, 'itens' segue liberando
  -- o tenant inteiro (comportamento antigo).
  IF v_alvo_tipo = 'itens' THEN
    v_sel_ts := v_alvo_ids;
    v_sel_desp := v_alvo_ids;
    v_sel_regra := v_alvo_ids;
    IF jsonb_typeof(p_payload->'alvo_chaves') = 'array' THEN
      SELECT
        v_sel_ts || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'timesheet'), ARRAY[]::uuid[]),
        v_sel_desp || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'despesa'), ARRAY[]::uuid[]),
        v_sel_regra || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo NOT IN ('timesheet', 'despesa')), ARRAY[]::uuid[])
      INTO v_sel_ts, v_sel_desp, v_sel_regra
      FROM (
        SELECT split_part(value, ':', 2) AS tipo, split_part(value, ':', 3)::uuid AS origem
        FROM jsonb_array_elements_text(p_payload->'alvo_chaves') AS t(value)
        WHERE value ~* '^fila:[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) m;
    END IF;
    v_filtra_itens := COALESCE(array_length(v_sel_ts, 1), 0)
                    + COALESCE(array_length(v_sel_desp, 1), 0)
                    + COALESCE(array_length(v_sel_regra, 1), 0) > 0;
  END IF;

  -- Passo 7: barra hora sem preço antes de criar qualquer item.
  -- Com 'itens' os alvo_ids não são casos: a trava roda logo abaixo, só sobre
  -- as horas marcadas (uma hora sem preço de outro cargo não deve travar a
  -- que a pessoa escolheu).
  IF NOT v_somente_regras AND v_alvo_tipo <> 'itens' AND array_length(v_alvo_ids, 1) > 0 THEN
    PERFORM public.validar_precos_antes_de_liberar(v_tenant_id, v_alvo_ids);
  END IF;
  IF NOT v_somente_regras AND v_filtra_itens AND COALESCE(array_length(v_sel_ts, 1), 0) > 0 THEN
    -- Mesma regra de validar_precos_antes_de_liberar, restrita à seleção.
    SELECT string_agg(DISTINCT format('caso %s (%s)', cs.numero, COALESCE(cg.nome, 'sem cargo')), '; ')
      INTO v_msg_preco
    FROM operations.timesheets t
    JOIN contracts.casos cs ON cs.id = t.caso_id
    LEFT JOIN people.cargos cg ON cg.id = t.cargo_id
    WHERE t.tenant_id = v_tenant_id
      AND t.apagado_em IS NULL
      AND t.id = ANY(v_sel_ts)
      AND t.status = 'em_lancamento'
      AND COALESCE(t.horas, 0) > 0
      AND (
        COALESCE(NULLIF(cs.regra_cobranca, ''), '') IN ('hora', 'hora_com_cap')
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                 THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
          WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca', '') IN ('hora', 'hora_com_cap')
        )
      )
      AND COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) <= 0;
    IF v_msg_preco IS NOT NULL THEN
      RAISE EXCEPTION 'Não dá para liberar: sem valor/hora definido para %. Cadastre o valor na regra de cobrança do caso (ou o cargo na tabela de preço) antes de liberar.', v_msg_preco;
    END IF;
  END IF;
  IF v_data_inicio IS NULL OR v_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;
  IF v_data_inicio > v_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;
  IF v_alvo_tipo NOT IN ('cliente', 'contrato', 'caso', 'itens') THEN
    RAISE EXCEPTION 'Tipo de alvo inválido';
  END IF;
  IF v_alvo_tipo IN ('cliente', 'contrato', 'caso') AND COALESCE(array_length(v_alvo_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'alvo_id/alvo_ids é obrigatório para cliente/contrato/caso';
  END IF;
  INSERT INTO finance.billing_batches (
    tenant_id,
    status,
    alvo_tipo,
    alvo_id,
    data_inicio,
    data_fim,
    created_by,
    updated_by
  )
  VALUES (
    v_tenant_id,
    'em_revisao',
    v_alvo_tipo,
    -- com 'itens' o alvo_id seria um timesheet/despesa, não um cliente/contrato/caso
    CASE WHEN v_alvo_tipo <> 'itens' AND COALESCE(array_length(v_alvo_ids, 1), 0) = 1 THEN v_alvo_ids[1] ELSE NULL END,
    v_data_inicio,
    v_data_fim,
    p_user_id,
    p_user_id
  )
  RETURNING id, numero INTO v_batch_id, v_batch_numero;
  WITH eligible_timesheet AS (
    SELECT
      t.id AS origem_id,
      t.data_lancamento AS data_referencia,
      t.horas AS horas_informadas,
      -- Mesma regra da fila (get_itens_a_faturar): caso com cobranca mensal
      -- ja paga o trabalho, entao a hora vale zero. Se a fila e o gerador
      -- divergirem aqui, a pessoa confere R$ 0 e o item nasce com valor —
      -- foi o que aconteceu com a competencia da hora em 31/08.
      CASE
        WHEN COALESCE(NULLIF(rg.regra, ''), '') IN
             ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
         AND COALESCE((rg.cfg->>'cobra_excedente')::boolean, false) = false
        THEN 0
        ELSE COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
      END AS valor_hora,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      t.descricao AS ts_descricao,
      autor.nome AS ts_autor_nome,
      t.created_by AS ts_autor_user_id
    FROM operations.timesheets t
    JOIN contracts.contratos c
      ON c.id = t.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = c.cliente_id
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = t.caso_id
     AND cs.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(r0.x->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra,
        COALESCE(r0.x->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb) AS cfg
      FROM (
        SELECT CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
           AND jsonb_array_length(cs.regras_financeiras) > 0
          THEN cs.regras_financeiras->0
          ELSE '{}'::jsonb END AS x
      ) r0
    ) rg
    LEFT JOIN people.colaboradores autor
      ON autor.user_id = t.created_by
     AND autor.tenant_id = v_tenant_id
    WHERE t.tenant_id = v_tenant_id
      -- Hora segue a COMPETENCIA, nao a data em que foi digitada: trabalho de
      -- agosto e cobrado em setembro (Filipe, 31/08 e 01/09, sem excecao).
      -- Precisa ser igual ao filtro de get_itens_a_faturar — se a tela e o
      -- gerador lerem campos diferentes, a fatura sai diferente do que a
      -- pessoa conferiu. Foi o que aconteceu: tela mostrava 1.827 horas e o
      -- gerador pegava 1.
      AND COALESCE(t.periodo_faturamento, t.data_lancamento::date)
          BETWEEN v_data_inicio AND v_data_fim
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      -- 28/09: só as horas marcadas na fila
      AND (NOT v_filtra_itens OR t.id = ANY(v_sel_ts))
      -- Lixeira: hora apagada ou excluída da fila não é gerada (antes o
      -- gerador não lia excluido_faturamento).
      AND t.apagado_em IS NULL
      AND NOT COALESCE(t.excluido_faturamento, false)
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = t.id
          AND bi.status <> 'cancelado'
      )
  ),
  eligible_rules_source AS (
    SELECT
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      rule_item,
      COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
      COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
      COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
      z.dia_inicio_faturamento,
      z.data_inicio_faturamento,
      COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status
    FROM contracts.casos cs
    JOIN contracts.contratos c ON c.id = cs.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT x AS rule_item
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
            THEN cs.regras_financeiras
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id', 'legacy-' || cs.id::text,
              'status', cs.status,
              'regra_cobranca', cs.regra_cobranca,
              'data_inicio_faturamento', cs.data_inicio_faturamento,
              'dia_inicio_faturamento', cs.dia_inicio_faturamento,
              'regra_cobranca_config', COALESCE(cs.regra_cobranca_config, '{}'::jsonb)
            )
          )
        END
      ) AS x
    ) r
    CROSS JOIN LATERAL public.z6_resolve_inicio_faturamento(
      r.rule_item,
      cs.data_inicio_faturamento,
      cs.dia_inicio_faturamento,
      c.created_at::date,
      v_data_inicio
    ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
    WHERE cs.tenant_id = v_tenant_id
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
  ),
  eligible_rules_enriched AS (
    SELECT
      ers.*,
      (
        SELECT sm.valor
        FROM config.salario_minimo sm
        WHERE sm.tenant_id = v_tenant_id
          AND sm.vigencia_desde <= GREATEST(ers.data_inicio_faturamento, v_data_inicio)::date
        ORDER BY sm.vigencia_desde DESC
        LIMIT 1
      ) AS valor_sm_ref
    FROM eligible_rules_source ers
  ),
  eligible_rules_calc AS (
    SELECT
      ers.*,
      finance.rule_origin_uuid(ers.caso_id, ers.rule_id) AS origem_id,
      CASE
        WHEN ers.regra_cobranca IN ('mensal', 'mensalidade_processo') THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                -- trava do dia do mes removida — ver comentario em get_itens_a_faturar
              )
            )
        WHEN ers.regra_cobranca = 'mensalidade_carteira' THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal_carteira', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                -- trava do dia do mes removida — ver comentario em get_itens_a_faturar
              )
            )
        WHEN ers.regra_cobranca IN ('projeto', 'pro_labore') THEN
          CASE
            WHEN jsonb_typeof(ers.cfg->'parcelas') = 'array' AND jsonb_array_length(ers.cfg->'parcelas') > 0 THEN
              COALESCE((
                SELECT SUM(COALESCE(NULLIF(p->>'valor', '')::numeric, 0))
                FROM jsonb_array_elements(ers.cfg->'parcelas') p
                WHERE NULLIF(p->>'data_pagamento', '')::date BETWEEN v_data_inicio AND v_data_fim
              ), 0)
            WHEN ers.data_inicio_faturamento BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(NULLIF(ers.cfg->>'valor_projeto', '')::numeric, 0)
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'exito' THEN
          CASE
            WHEN NULLIF(ers.cfg->>'data_pagamento_exito', '')::date BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(
                NULLIF(ers.cfg->>'valor_exito_calculado', '')::numeric,
                (COALESCE(NULLIF(ers.cfg->>'valor_acao', '')::numeric, 0)
                  * COALESCE(NULLIF(ers.cfg->>'percentual_exito', '')::numeric, 0) / 100.0)
              )
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'salario_minimo' THEN
          COALESCE(NULLIF(ers.rule_item->>'quantidade_sm', '')::numeric, NULLIF(ers.cfg->>'quantidade_sm', '')::numeric, 0)
          * COALESCE(ers.valor_sm_ref, 0)
        ELSE 0
      END::numeric(14,2) AS valor_regra
    FROM eligible_rules_enriched ers
    WHERE ers.regra_cobranca IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'projeto', 'pro_labore', 'exito', 'salario_minimo')
      AND ers.rule_status = 'ativo'
  ),
  inserted_timesheet AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      e.cliente_id,
      e.contrato_id,
      e.caso_id,
      'timesheet',
      e.origem_id,
      e.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      (COALESCE(e.horas_informadas, 0) * COALESCE(e.valor_hora, 0))::numeric(14,2),
      e.horas_informadas,
      jsonb_build_object(
        'cliente_id', e.cliente_id,
        'cliente_nome', e.cliente_nome,
        'contrato_id', e.contrato_id,
        'contrato_numero', e.contrato_numero,
        'contrato_nome', e.nome_contrato,
        'caso_id', e.caso_id,
        'caso_numero', e.caso_numero,
        'caso_nome', e.caso_nome,
        'valor_hora', COALESCE(e.valor_hora, 0),
        'origem', 'timesheet',
        -- autor do lançamento: exibição estável mesmo se o timesheet sumir depois
        'timesheet_profissional', COALESCE(e.ts_autor_nome, ''),
        'timesheet_autor_user_id', e.ts_autor_user_id,
        'timesheet_data_lancamento', e.data_referencia::text,
        'timesheet_descricao', COALESCE(e.ts_descricao, ''),
        'timesheet_horas', COALESCE(e.horas_informadas, 0)
      ),
      p_user_id,
      p_user_id
    FROM eligible_timesheet e
    -- 'Gerar faturamento do mês' não arrasta horas: elas entram quando o
    -- financeiro envia (por caso/contrato) — call de 08/07.
    WHERE NOT v_somente_regras
    RETURNING id
  ),
  inserted_regras AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      r.cliente_id,
      r.contrato_id,
      r.caso_id,
      'regra_financeira',
      r.origem_id,
      GREATEST(r.data_inicio_faturamento, v_data_inicio),
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      COALESCE(r.valor_regra, 0)::numeric(14,2),
      0,
      jsonb_build_object(
        'cliente_id', r.cliente_id,
        'cliente_nome', r.cliente_nome,
        'contrato_id', r.contrato_id,
        'contrato_numero', r.contrato_numero,
        'contrato_nome', r.nome_contrato,
        'caso_id', r.caso_id,
        'caso_numero', r.caso_numero,
        'caso_nome', r.caso_nome,
        'regra_id', r.rule_id,
        'regra_cobranca', r.regra_cobranca,
        'origem', 'regra_financeira',
        'regra', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN 'salario_minimo' ELSE NULL END,
        'quantidade_sm', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN COALESCE(NULLIF(r.rule_item->>'quantidade_sm', '')::numeric, NULLIF(r.cfg->>'quantidade_sm', '')::numeric) ELSE NULL END,
        'valor_sm_no_lancamento', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN r.valor_sm_ref ELSE NULL END
      ),
      p_user_id,
      p_user_id
    FROM eligible_rules_calc r
    WHERE r.valor_regra > 0
      -- 28/09: só as regras marcadas na fila. A fila (get_itens_a_faturar)
      -- mostra UMA linha por mês/parcela/êxito, com origem_id derivado
      -- (rule_origin_uuid(caso, rule_id || ':mensal:YYYYMM' | ':parcela:N' |
      -- ':projeto_unico' | ':exito')); o gerador cria UM item por regra no
      -- período, com origem_id = rule_origin_uuid(caso, rule_id). Então aceita
      -- o id do gerador e qualquer id de linha da fila dessa regra no período.
      -- Como a fila é sempre mensal, marcar a linha = gerar a regra do mês.
      AND (
        NOT v_filtra_itens
        OR r.origem_id = ANY(v_sel_regra)
        OR EXISTS (
          SELECT 1
          FROM (
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':mensal:' || to_char(gs.ref_mes, 'YYYYMM')) AS fila_id
            FROM generate_series(
              date_trunc('month', v_data_inicio)::date,
              date_trunc('month', v_data_fim)::date,
              interval '1 month'
            ) AS gs(ref_mes)
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':parcela:' || p.ord::text)
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(r.cfg->'parcelas') = 'array' THEN r.cfg->'parcelas' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS p(item, ord)
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':projeto_unico')
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':exito')
          ) f
          WHERE f.fila_id = ANY(v_sel_regra)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.origem_id = r.origem_id
          AND bi.periodo_inicio = v_data_inicio
          AND bi.periodo_fim = v_data_fim
          AND bi.status <> 'cancelado'
      )
    RETURNING id
  )
  SELECT
    COALESCE((SELECT count(*) FROM inserted_timesheet), 0)
    + COALESCE((SELECt count(*) FROM inserted_regras), 0)
  INTO v_items_count;

  -- 28/09: despesas marcadas na fila. A edge só chama o fallback de despesas
  -- quando esta função não cria nada; numa seleção mista (horas + despesas)
  -- as despesas ficariam para trás. Então o fallback roda aqui, com o mesmo
  -- payload (ele filtra por alvo_ids/alvo_chaves), e o lote extra é solto na
  -- hora — igual ao que a edge faz com o lote principal.
  IF v_filtra_itens AND COALESCE(array_length(v_sel_desp, 1), 0) > 0 THEN
    BEGIN
      v_desp := public.start_faturamento_despesas_fallback(p_user_id, p_payload);
      v_desp_count := COALESCE((v_desp->>'itens_criados')::int, 0);
      IF NULLIF(v_desp->>'batch_id', '') IS NOT NULL THEN
        PERFORM public.detach_faturamento_batch(p_user_id, (v_desp->>'batch_id')::uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE 'Nenhum item elegível%' THEN
        v_desp_count := 0;
      ELSE
        RAISE;
      END IF;
    END;
  END IF;
  IF v_items_count = 0 AND v_desp_count > 0 THEN
    -- só despesas: o lote de horas/regras nasceu vazio, some
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    v_batch_id := NULL;
    v_batch_numero := NULL;
  END IF;
  v_items_count := v_items_count + v_desp_count;

  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    -- Gerar do mês é idempotente: se as regras do mês já foram geradas,
    -- responde ok (0 novos) em vez de erro — evita o "não consigo forçar".
    IF v_somente_regras THEN
      RETURN jsonb_build_object(
        'batch_id', NULL,
        'batch_numero', NULL,
        'itens_criados', 0,
        'mensagem', 'Todas as regras do período já estavam geradas — nenhum item novo.'
      );
    END IF;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;
  UPDATE operations.timesheets t
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND v_batch_id IS NOT NULL
    AND t.id IN (
      SELECT bi.origem_id
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.billing_batch_id = v_batch_id
        AND bi.origem_tipo = 'timesheet'
    )
    AND t.status = 'em_lancamento';

  -- 18/10: aprovação automática dos itens de regra projeto (sem parcelas).
  -- Só age com a chave do tenant ligada (finance.autoaprovacao_projeto_ligada,
  -- core.system_settings 'faturamento.autoaprovar_projeto'); desligada devolve
  -- 0 e o lote sai exatamente como antes — tudo em_revisao.
  IF v_batch_id IS NOT NULL THEN
    v_auto_count := finance.auto_aprovar_itens_projeto(p_user_id, v_tenant_id, v_batch_id);
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  ) || CASE WHEN v_auto_count > 0
            THEN jsonb_build_object('itens_autoaprovados', v_auto_count)
            ELSE '{}'::jsonb END;
END;
$function$;

-- public.excluir_timesheets_do_faturamento — excluir da fila
CREATE OR REPLACE FUNCTION public.excluir_timesheets_do_faturamento(p_user_id uuid, p_ids uuid[], p_excluir boolean DEFAULT true, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_count int := 0;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Desfazer a exclusão = restaurar da lixeira: permissão própria
  -- (finance.faturamento.lixeira.restore), janela de 12 meses e volta no mês
  -- corrente. Antes bastava finance.faturamento.write.
  IF NOT COALESCE(p_excluir, true) THEN
    RETURN public.restaurar_timesheets_lixeira(p_user_id, p_ids);
  END IF;

  -- Mesma permissao de quem ja libera faturamento (start_faturamento_flow):
  -- excluir da fila e uma decisao do mesmo tipo, nao um papel novo.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write', 'finance.faturamento.manage',
      'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para excluir lançamentos do faturamento';
  END IF;

  UPDATE operations.timesheets t
  SET excluido_faturamento = true,
      excluido_faturamento_por = p_user_id,
      excluido_faturamento_em = now(),
      excluido_faturamento_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
      updated_at = now(),
      updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND t.id = ANY(p_ids)
    AND NOT t.excluido_faturamento
    AND t.apagado_em IS NULL
    -- Uma vez ja faturado (existe billing_item ativo apontando pra ele) a
    -- exclusao daqui nao tem efeito nenhum — a linha ja saiu da fila. Evita a
    -- falsa sensacao de ter excluido algo que na verdade ja foi liberado.
    AND NOT EXISTS (
      SELECT 1 FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
        AND bi.origem_id = t.id AND bi.status <> 'cancelado'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('afetados', v_count);
END;
$function$;

-- public.restaurar_timesheets_lixeira — restaurar excluído (etapa 1)
CREATE OR REPLACE FUNCTION public.restaurar_timesheets_lixeira(p_user_id uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_mes date := date_trunc('month', CURRENT_DATE)::date;
  v_count int := 0;
  v_pedidos int := COALESCE(array_length(p_ids, 1), 0);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT finance._tem_permissao_nominal(p_user_id, 'finance.faturamento.lixeira.restore') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar lançamentos da lixeira do faturamento';
  END IF;

  -- Mesmo efeito de postergar_timesheet (20260812120000): a competência do
  -- timesheet na fila é COALESCE(periodo_faturamento, data_lancamento), então
  -- gravar periodo_faturamento = mês corrente o põe na fila deste mês.
  -- postergar_timesheet também cancela um billing_item ativo; aqui isso não
  -- acontece — a exclusão só marca timesheet SEM billing_item ativo, e a
  -- fila não gera item de lançamento excluído. Mesmo assim, por garantia, um
  -- timesheet com billing_item ativo não é tocado (contaria em dobro).
  UPDATE operations.timesheets t
  SET excluido_faturamento = false,
      excluido_faturamento_por = NULL,
      excluido_faturamento_em = NULL,
      excluido_faturamento_motivo = NULL,
      -- Mês original já passou -> mês corrente. Ainda não chegou (hora do mês
      -- corrente tem competência no mês seguinte, ver
      -- operations._periodo_faturamento_padrao) -> fica onde estava: restaurar
      -- não pode ADIANTAR a cobrança.
      periodo_faturamento = GREATEST(v_mes, COALESCE(t.periodo_faturamento, t.data_lancamento::date)),
      -- Marcador para Postergados não confundir restauração com adiamento.
      restaurado_da_lixeira_em = now(),
      restaurado_da_lixeira_por = p_user_id,
      updated_at = now(),
      updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND t.id = ANY(p_ids)
    AND t.excluido_faturamento
    AND t.excluido_faturamento_em >= now() - interval '12 months'
    AND t.apagado_em IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
        AND bi.origem_id = t.id AND bi.status <> 'cancelado'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'afetados', v_count,
    'ignorados', GREATEST(v_pedidos - v_count, 0),
    'mes_corrente', v_mes
  );
END;
$function$;

-- public.postergar_timesheet — postergar
CREATE OR REPLACE FUNCTION public.postergar_timesheet(p_user_id uuid, p_timesheet_id uuid, p_periodo date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_bi finance.billing_items%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.write','finance.faturamento.manage',
                               'finance.faturamento.review','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para postergar lançamento';
  END IF;

  IF p_periodo IS NULL THEN RAISE EXCEPTION 'Novo período é obrigatório'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM operations.timesheets t WHERE t.id = p_timesheet_id AND t.tenant_id = v_tenant_id AND t.apagado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'Timesheet não encontrado';
  END IF;

  -- Se ja existe billing_item ativo para esse timesheet (postergar a partir da
  -- revisao, nao da fila pre-batch), ele precisa sair da fatura atual — senao
  -- o item continua contando agora E de novo quando for pego no mes de destino.
  SELECT * INTO v_bi FROM finance.billing_items bi
  WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
    AND bi.origem_id = p_timesheet_id AND bi.status <> 'cancelado';

  IF FOUND THEN
    IF v_bi.status = 'faturado' THEN
      RAISE EXCEPTION 'Item já faturado não pode ser postergado';
    END IF;
    UPDATE finance.billing_items
    SET status = 'cancelado', grupo_id = NULL, updated_at = now(), updated_by = p_user_id
    WHERE id = v_bi.id;
  END IF;

  UPDATE operations.timesheets
  SET periodo_faturamento = p_periodo, updated_at = now(), updated_by = p_user_id
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_timesheet_id, 'periodo_faturamento', p_periodo);
END;
$function$;

-- public.set_timesheet_periodo_faturamento — competência manual
CREATE OR REPLACE FUNCTION public.set_timesheet_periodo_faturamento(p_user_id uuid, p_id uuid, p_periodo date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  UPDATE operations.timesheets t SET periodo_faturamento = p_periodo, updated_at = now(), updated_by = p_user_id
  WHERE t.id = p_id AND t.tenant_id = v_tenant AND t.apagado_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Timesheet não encontrado'; END IF;
  RETURN jsonb_build_object('id', p_id, 'periodo_faturamento', p_periodo);
END;
$function$;

-- public.set_timesheet_status — status do lançamento
CREATE OR REPLACE FUNCTION public.set_timesheet_status(p_user_id uuid, p_timesheet_id uuid, p_status character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_timesheet record;
  v_colaborador_id uuid;
  v_is_reviewer boolean;
  v_is_socio boolean;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF p_status NOT IN ('em_lancamento', 'revisao', 'aprovado') THEN
    RAISE EXCEPTION 'Status inválido';
  END IF;

  SELECT t.* INTO v_timesheet
  FROM operations.timesheets t
  WHERE t.id = p_timesheet_id AND t.tenant_id = v_tenant_id AND t.apagado_em IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet não encontrado';
  END IF;

  SELECT c.id,
         (lower(c.categoria::text) = 'socio')
  INTO v_colaborador_id, v_is_socio
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id AND c.ativo = true
  LIMIT 1;

  v_is_reviewer := EXISTS (
    SELECT 1
    FROM contracts.casos cs,
         LATERAL jsonb_array_elements(COALESCE(cs.timesheet_config->'revisores', '[]'::jsonb)) r
    WHERE cs.id = v_timesheet.caso_id
      AND NULLIF(r->>'colaborador_id', '')::uuid = v_colaborador_id
  );

  IF p_status = 'em_lancamento' AND v_timesheet.created_by <> p_user_id THEN
    RAISE EXCEPTION 'Apenas o criador pode retornar para lançamento';
  END IF;

  IF p_status = 'revisao' AND NOT v_is_reviewer THEN
    RAISE EXCEPTION 'Somente revisor pode enviar para revisão';
  END IF;

  IF p_status = 'aprovado' AND NOT COALESCE(v_is_socio, false) THEN
    RAISE EXCEPTION 'Somente sócio pode aprovar';
  END IF;

  UPDATE operations.timesheets t
  SET
    status = p_status,
    revisado_por = CASE WHEN p_status = 'revisao' THEN p_user_id ELSE t.revisado_por END,
    aprovado_por = CASE WHEN p_status = 'aprovado' THEN p_user_id ELSE t.aprovado_por END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.id = p_timesheet_id
    AND t.tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_timesheet_id, 'status', p_status);
END;
$function$;

-- public.update_timesheet — editar lançamento
CREATE OR REPLACE FUNCTION public.update_timesheet(p_user_id uuid, p_timesheet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_current record;
  v_new_contrato_id uuid;
  v_new_caso_id uuid;
  v_new_ia boolean;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Quem pode editar é decidido por pode_editar_timesheet_de (próprio dono,
  -- capacidade nominal 'editar_todos', ou gestor da mesma área).
  SELECT * INTO v_current
  FROM operations.timesheets t
  WHERE t.id = p_timesheet_id
    AND t.tenant_id = v_tenant_id
    AND t.apagado_em IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF NOT public.pode_editar_timesheet_de(p_user_id, v_current.created_by) THEN
    RAISE EXCEPTION 'Você não pode editar o lançamento de outra pessoa. Só o autor, a diretoria ou o gestor da área dele podem.';
  END IF;

  -- Decisão do cliente (03/08): edição de terceiro vale só ANTES da liberação.
  -- Depois disso o ajuste é feito na revisão de fatura, que recalcula valores.
  IF v_current.status <> 'em_lancamento' THEN
    RAISE EXCEPTION 'Este lançamento já foi liberado para faturamento. Ajuste pela tela de Revisão de fatura.';
  END IF;

  v_new_contrato_id := COALESCE(NULLIF(p_payload->>'contrato_id', '')::uuid, v_current.contrato_id);
  v_new_caso_id := COALESCE(NULLIF(p_payload->>'caso_id', '')::uuid, v_current.caso_id);
  v_new_ia := COALESCE(NULLIF(p_payload->>'ia_auxiliado', '')::boolean, v_current.ia_auxiliado);

  IF NOT EXISTS (
    SELECT 1
    FROM contracts.casos cs
    WHERE cs.id = v_new_caso_id
      AND cs.contrato_id = v_new_contrato_id
      AND cs.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Caso não pertence ao contrato informado';
  END IF;

  UPDATE operations.timesheets t
  SET
    contrato_id = v_new_contrato_id,
    caso_id = v_new_caso_id,
    data_lancamento = COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, t.data_lancamento),
    horas = COALESCE(NULLIF(p_payload->>'horas', '')::numeric, t.horas),
    duracao_minutos = COALESCE(NULLIF(p_payload->>'duracao_minutos', '')::integer, t.duracao_minutos),
    descricao = COALESCE(NULLIF(p_payload->>'descricao', ''), t.descricao),
    ia_auxiliado = v_new_ia,
    ia_minutos = CASE
      WHEN NOT v_new_ia THEN NULL
      ELSE COALESCE(NULLIF(p_payload->>'ia_minutos', '')::integer, t.ia_minutos)
    END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.id = p_timesheet_id
    AND t.tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_timesheet_id);
END;
$function$;

-- public.reset_faturamento_periodo — zerar faturamento
CREATE OR REPLACE FUNCTION public.reset_faturamento_periodo(p_data_inicio date, p_data_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_itens int := 0;
  v_batches int := 0;
  v_ts int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = auth.uid() AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(auth.uid()) p
    WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Apenas quem gerencia o faturamento pode reiniciar o período';
  END IF;

  -- Proteção: nota fiscal VIVA (não cancelada) indica faturamento real em
  -- curso — cancele antes de zerar. Nota cancelada não bloqueia (o histórico
  -- fiscal fica preservado; só a esteira é limpa).
  IF EXISTS (
    SELECT 1 FROM finance.billing_notes n
    WHERE n.tenant_id = v_tenant_id
      AND n.tipo_documento = 'nota_fiscal_servico'
      AND COALESCE(n.status, '') NOT ILIKE '%cancel%'
  ) THEN
    RAISE EXCEPTION 'Há notas fiscais emitidas e não canceladas — cancele as notas antes de zerar.';
  END IF;

  -- Devolve TODAS as horas em circulação para "em lançamento": é o que faz
  -- o Gerar/Liberar recarregá-las no ciclo seguinte.
  UPDATE operations.timesheets t
  SET status = 'em_lancamento', updated_at = now(), updated_by = auth.uid()
  WHERE t.tenant_id = v_tenant_id
    AND t.status IN ('revisao', 'aprovado')
    AND t.apagado_em IS NULL;

  -- DESPESA VOLTA JUNTO. Ate 01/09 o reset devolvia so o timesheet e esquecia
  -- operations.despesas: a despesa ficava presa em 'revisao', sumia da fila (que
  -- so mostra 'em_lancamento') e ficava sem item de faturamento — sem como ser
  -- cobrada, e sem nada na tela explicando por que. Foi o que o Filipe viu ao
  -- zerar setembro: 'reiniciei tudo e as despesas nao voltaram'.
  UPDATE operations.despesas d
  SET status = 'em_lancamento', updated_at = now(), updated_by = auth.uid()
  WHERE d.tenant_id = v_tenant_id
    AND d.status IN ('revisao', 'aprovado')
    AND d.apagado_em IS NULL;
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  DELETE FROM finance.revisao_fatura_itens_historico h
  WHERE h.tenant_id = v_tenant_id;

  -- billing_item_audit cai por ON DELETE CASCADE.
  DELETE FROM finance.billing_items
  WHERE tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  -- Lotes sem nota pendurada somem; lote com nota (mesmo cancelada) fica,
  -- para a nota não perder a referência.
  DELETE FROM finance.billing_batches b
  WHERE b.tenant_id = v_tenant_id
    AND NOT EXISTS (SELECT 1 FROM finance.billing_notes n WHERE n.billing_batch_id = b.id);
  GET DIAGNOSTICS v_batches = ROW_COUNT;

  RETURN jsonb_build_object(
    'itens_removidos', v_itens,
    'lotes_removidos', v_batches,
    'timesheets_devolvidos', v_ts
  );
END;
$function$;

-- public.get_despesas — lista da tela Despesas
CREATE OR REPLACE FUNCTION public.get_despesas(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people', 'operations', 'contracts', 'crm', 'finance'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_is_admin_socio boolean := false;
  v_has_manage_perm boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
  v_eh_coord boolean := false;
  v_is_gestor boolean := false;
  v_can_view_all boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  v_is_admin_socio := public.is_admin_or_socio(p_user_id, v_tenant_id);

  -- Permissão explícita de gestão (despesas ou faturamento) => vê tudo.
  -- Inclui finance.* para não quebrar a visão do time de faturamento.
  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'operations.despesas.manage',
      'operations.despesas.*',
      'operations.*',
      'finance.faturamento.manage',
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.*',
      '*'
    )
  ) INTO v_has_manage_perm;

  SELECT col.area_id, a.nome, COALESCE(col.eh_coordenador, false)
  INTO v_viewer_area_id, v_viewer_area_nome, v_eh_coord
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Gestor = sócio/admin OU coordenador de área.
  v_is_gestor := v_is_admin_socio OR v_eh_coord;

  -- Vê tudo só quem tem permissão de gestão OU é diretor
  -- (centro de custo 'VLMA' ou sem área). Sócio/coordenador de área específica
  -- fica escopado à sua área.
  v_can_view_all := v_has_manage_perm
    OR (v_is_admin_socio AND (v_viewer_area_id IS NULL OR v_viewer_area_nome = 'VLMA'));

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'contrato_id', d.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_numero_sequencial', ct.numero_sequencial,
        'contrato_nome', ct.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'cliente_id', ct.cliente_id,
        'cliente_nome', cli.nome,
        'data_lancamento', d.data_lancamento,
        'categoria', d.categoria,
        'valor', COALESCE(d.valor, 0),
        'descricao', d.descricao,
        'status', d.status,
        'reembolsavel', COALESCE(d.reembolsavel, true),
        'arquivo_nome', d.arquivo_nome,
        'mime_type', d.mime_type,
        'tamanho_bytes', d.tamanho_bytes,
        'anexos', (
          SELECT jsonb_agg(item ORDER BY ord)
          FROM (
            SELECT 0 AS ord, jsonb_build_object(
              'id', d.id, 'kind', 'primario',
              'arquivo_nome', d.arquivo_nome, 'mime_type', d.mime_type, 'tamanho_bytes', d.tamanho_bytes
            ) AS item
            WHERE d.arquivo_nome IS NOT NULL
            UNION ALL
            SELECT 1 AS ord, jsonb_build_object(
              'id', a.id, 'kind', 'extra',
              'arquivo_nome', a.arquivo_nome, 'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes
            )
            FROM operations.despesa_anexos a
            WHERE a.despesa_id = d.id
          ) s
        ),
        'centro_custo', ca.nome,
        -- Ja virou item de cobranca? E o que impede cobrar duas vezes a mesma
        -- despesa, uma na fatura e outra na nota de debito.
        'ja_faturada', EXISTS (
          SELECT 1 FROM finance.billing_items bi
          WHERE bi.tenant_id = d.tenant_id AND bi.origem_tipo = 'despesa'
            AND bi.origem_id = d.id AND bi.status <> 'cancelado'
        ),
        'lote_id', d.lote_id,
        'lote_descricao', lo.descricao,
        'lote_status', lo.status,
        'created_by', d.created_by,
        'created_by_nome', cb.nome,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      )
      ORDER BY d.data_lancamento DESC, d.created_at DESC
    )
    FROM operations.despesas d
    JOIN contracts.contratos ct ON ct.id = d.contrato_id
    JOIN contracts.casos cs ON cs.id = d.caso_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = d.created_by AND cb.tenant_id = d.tenant_id
    LEFT JOIN people.areas ca ON ca.id = cb.area_id AND ca.tenant_id = d.tenant_id
    LEFT JOIN operations.despesa_lotes lo ON lo.id = d.lote_id
    WHERE d.tenant_id = v_tenant_id
      AND d.apagado_em IS NULL
      AND (
        v_can_view_all
        OR d.created_by = p_user_id
        -- Despesa que está num lote DA PESSOA continua sendo dela, mesmo que
        -- quem tenha digitado seja o financeiro.
        OR lo.colaborador_user_id = p_user_id
        OR (
          -- gestor de área específica vê as despesas das pessoas do seu centro de custo
          v_is_gestor
          AND v_viewer_area_id IS NOT NULL
          AND cb.area_id = v_viewer_area_id
        )
      )
      AND (NULLIF(p_filters->>'contrato_id', '') IS NULL OR d.contrato_id = (p_filters->>'contrato_id')::uuid)
      AND (NULLIF(p_filters->>'caso_id', '') IS NULL OR d.caso_id = (p_filters->>'caso_id')::uuid)
      -- Filtro por lote: o financeiro precisa ver as despesas de UM lote sem
      -- sair da tela de contas a pagar (pedido Filipe 17/08).
      AND (NULLIF(p_filters->>'lote_id', '') IS NULL OR d.lote_id = (p_filters->>'lote_id')::uuid)
      AND (NULLIF(p_filters->>'status', '') IS NULL OR d.status = p_filters->>'status')
      AND (NULLIF(p_filters->>'categoria', '') IS NULL OR lower(d.categoria) = lower(p_filters->>'categoria'))
      -- Por competencia (mes em que se cobra) ou por data do gasto?
      -- A tela de Despesas quer a data do gasto: filtrar agosto mostra agosto.
      -- O faturamento quer a competencia: despesa de agosto e cobrada em
      -- setembro (Filipe, 01/09). Por isso o modo e opcional, e quem fatura liga.
      AND (
        NOT COALESCE((p_filters->>'por_competencia')::boolean, false)
        OR (
          (NULLIF(p_filters->>'data_inicio', '') IS NULL
            OR COALESCE(d.periodo_faturamento, d.data_lancamento) >= (p_filters->>'data_inicio')::date)
          AND (NULLIF(p_filters->>'data_fim', '') IS NULL
            OR COALESCE(d.periodo_faturamento, d.data_lancamento) <= (p_filters->>'data_fim')::date)
        )
      )
      AND (
        COALESCE((p_filters->>'por_competencia')::boolean, false)
        OR (
          (NULLIF(p_filters->>'data_inicio', '') IS NULL OR d.data_lancamento >= (p_filters->>'data_inicio')::date)
          AND (NULLIF(p_filters->>'data_fim', '') IS NULL OR d.data_lancamento <= (p_filters->>'data_fim')::date)
        )
      )
  ), '[]'::jsonb);
END;
$function$;

-- public.get_despesas_dashboard — dashboard de despesas
CREATE OR REPLACE FUNCTION public.get_despesas_dashboard(p_user_id uuid, p_ref_month date DEFAULT NULL::date, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_ref_start date := date_trunc('month', COALESCE(p_ref_month, v_today))::date;
  v_ref_end date := (date_trunc('month', COALESCE(p_ref_month, v_today)) + interval '1 month')::date;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN jsonb_build_object(
    -- KPIs relativos a hoje (não filtrados)
    'hoje', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND status<>'cancelado' AND data_lancamento = v_today),
    'semana', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND status<>'cancelado' AND data_lancamento >= v_week_start),
    'mes', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND status<>'cancelado' AND data_lancamento >= v_month_start),
    -- Total do período filtrado (mês + cliente)
    'filtro_total', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas
      WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND status<>'cancelado'
        AND data_lancamento >= v_ref_start AND data_lancamento < v_ref_end
        AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)),
    'por_cliente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cli.nome,'Sem cliente'), 'count', s.n, 'valor', s.v) ORDER BY s.v DESC)
      FROM (
        SELECT cliente_id, count(*) n, COALESCE(sum(valor),0) v
        FROM operations.despesas
        WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND status<>'cancelado'
          AND data_lancamento >= v_ref_start AND data_lancamento < v_ref_end
          AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
        GROUP BY cliente_id ORDER BY v DESC LIMIT 10
      ) s LEFT JOIN crm.clientes cli ON cli.id = s.cliente_id
    ), '[]'::jsonb),
    'por_caso', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cs.numero::text || ' — ' || cs.nome,'Sem caso'), 'count', s.n, 'valor', s.v) ORDER BY s.v DESC)
      FROM (
        SELECT caso_id, count(*) n, COALESCE(sum(valor),0) v
        FROM operations.despesas
        WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND status<>'cancelado'
          AND data_lancamento >= v_ref_start AND data_lancamento < v_ref_end
          AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
        GROUP BY caso_id ORDER BY v DESC LIMIT 10
      ) s LEFT JOIN contracts.casos cs ON cs.id = s.caso_id
    ), '[]'::jsonb),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', cli.id, 'nome', cli.nome) ORDER BY cli.nome)
      FROM (SELECT DISTINCT cliente_id FROM operations.despesas WHERE tenant_id=v_tenant_id AND apagado_em IS NULL AND cliente_id IS NOT NULL) d
      JOIN crm.clientes cli ON cli.id = d.cliente_id
    ), '[]'::jsonb)
  );
END;
$function$;

-- public.start_faturamento_despesas_fallback — gerador de despesas
CREATE OR REPLACE FUNCTION public.start_faturamento_despesas_fallback(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data_inicio date;
  v_data_fim date;
  v_alvo_tipo varchar;
  v_alvo_id uuid;
  v_alvo_ids uuid[] := ARRAY[]::uuid[];
  v_search text;
  v_batch_id uuid;
  v_batch_numero bigint;
  v_items_count int := 0;
  v_can_write boolean := false;
  -- 28/09: seleção de despesas da fila (ver bloco alvo_chaves abaixo)
  v_sel_ts uuid[] := ARRAY[]::uuid[];
  v_sel_desp uuid[] := ARRAY[]::uuid[];
  v_sel_regra uuid[] := ARRAY[]::uuid[];
  v_filtra_itens boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_write;

  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para iniciar fluxo de faturamento';
  END IF;

  v_data_inicio := NULLIF(p_payload->>'data_inicio', '')::date;
  v_data_fim := NULLIF(p_payload->>'data_fim', '')::date;
  v_alvo_tipo := COALESCE(NULLIF(p_payload->>'alvo_tipo', ''), 'itens');
  v_alvo_id := NULLIF(p_payload->>'alvo_id', '')::uuid;
  v_search := NULLIF(trim(COALESCE(p_payload->>'search', '')), '');

  IF jsonb_typeof(p_payload->'alvo_ids') = 'array' THEN
    SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_alvo_ids
    FROM jsonb_array_elements_text(p_payload->'alvo_ids') AS t(value)
    WHERE value IS NOT NULL
      AND value <> ''
      AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;

  IF v_alvo_id IS NOT NULL THEN
    v_alvo_ids := array_append(v_alvo_ids, v_alvo_id);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT entry), ARRAY[]::uuid[]) INTO v_alvo_ids
  FROM unnest(v_alvo_ids) AS entry;

  -- 28/09 (Filipe): "selecionar um a um e selecionar todos para liberar em
  -- massa". Com alvo_tipo='itens' a seleção chega por alvo_ids (origem_id da
  -- fila: timesheet.id, despesa.id ou o uuid da regra) e/ou alvo_chaves (os
  -- ids virtuais 'fila:<origem_tipo>:<origem_id>' que get_fila_por_competencia
  -- devolve). alvo_ids não diz o tipo, então vale para os três; alvo_chaves
  -- entra só no tipo que declara. Sem nenhum dos dois, 'itens' segue liberando
  -- o tenant inteiro (comportamento antigo).
  IF v_alvo_tipo = 'itens' THEN
    v_sel_ts := v_alvo_ids;
    v_sel_desp := v_alvo_ids;
    v_sel_regra := v_alvo_ids;
    IF jsonb_typeof(p_payload->'alvo_chaves') = 'array' THEN
      SELECT
        v_sel_ts || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'timesheet'), ARRAY[]::uuid[]),
        v_sel_desp || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'despesa'), ARRAY[]::uuid[]),
        v_sel_regra || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo NOT IN ('timesheet', 'despesa')), ARRAY[]::uuid[])
      INTO v_sel_ts, v_sel_desp, v_sel_regra
      FROM (
        SELECT split_part(value, ':', 2) AS tipo, split_part(value, ':', 3)::uuid AS origem
        FROM jsonb_array_elements_text(p_payload->'alvo_chaves') AS t(value)
        WHERE value ~* '^fila:[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) m;
    END IF;
    v_filtra_itens := COALESCE(array_length(v_sel_ts, 1), 0)
                    + COALESCE(array_length(v_sel_desp, 1), 0)
                    + COALESCE(array_length(v_sel_regra, 1), 0) > 0;
  END IF;

  IF v_data_inicio IS NULL OR v_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;

  IF v_data_inicio > v_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;

  IF v_alvo_tipo NOT IN ('cliente', 'contrato', 'caso', 'itens') THEN
    RAISE EXCEPTION 'Tipo de alvo inválido';
  END IF;

  IF v_alvo_tipo IN ('cliente', 'contrato', 'caso') AND COALESCE(array_length(v_alvo_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'alvo_id/alvo_ids é obrigatório para cliente/contrato/caso';
  END IF;

  -- Sincroniza cliente_id legado para garantir elegibilidade consistente.
  UPDATE operations.despesas d
  SET cliente_id = c.cliente_id
  FROM contracts.contratos c
  WHERE c.id = d.contrato_id
    AND c.tenant_id = d.tenant_id
    AND d.tenant_id = v_tenant_id
    AND (d.cliente_id IS NULL OR d.cliente_id <> c.cliente_id);

  INSERT INTO finance.billing_batches (
    tenant_id,
    status,
    alvo_tipo,
    alvo_id,
    data_inicio,
    data_fim,
    created_by,
    updated_by
  )
  VALUES (
    v_tenant_id,
    'em_revisao',
    v_alvo_tipo,
    CASE WHEN v_alvo_tipo <> 'itens' AND COALESCE(array_length(v_alvo_ids, 1), 0) = 1 THEN v_alvo_ids[1] ELSE NULL END,
    v_data_inicio,
    v_data_fim,
    p_user_id,
    p_user_id
  )
  RETURNING id, numero INTO v_batch_id, v_batch_numero;

  WITH eligible_despesas AS (
    SELECT
      d.id AS origem_id,
      d.data_lancamento AS data_referencia,
      COALESCE(d.valor, 0)::numeric(14,2) AS valor_informado,
      d.categoria,
      d.descricao,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      COALESCE(d.cliente_id, c.cliente_id) AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome
    FROM operations.despesas d
    JOIN contracts.contratos c
      ON c.id = d.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = COALESCE(d.cliente_id, c.cliente_id)
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = d.caso_id
     AND cs.tenant_id = v_tenant_id
    WHERE d.tenant_id = v_tenant_id
      -- Competencia, nao data do gasto: despesa de agosto e cobrada em
      -- setembro. Igual ao que start_faturamento_flow faz com a hora — se a
      -- tela e o gerador lerem campos diferentes, sai fatura diferente da que
      -- a pessoa conferiu.
      AND COALESCE(d.periodo_faturamento, d.data_lancamento) BETWEEN v_data_inicio AND v_data_fim
      AND d.status IN ('em_lancamento', 'revisao', 'aprovado')
      AND COALESCE(d.reembolsavel, true) = true
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND COALESCE(d.cliente_id, c.cliente_id) = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      -- 28/09: só as despesas marcadas na fila
      AND (NOT v_filtra_itens OR d.id = ANY(v_sel_desp))
      AND d.apagado_em IS NULL
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR COALESCE(d.categoria, '') ILIKE '%' || v_search || '%'
        OR COALESCE(d.descricao, '') ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'despesa'
          AND bi.origem_id = d.id
          AND bi.status <> 'cancelado'
      )
  ),
  inserted_despesas AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      d.cliente_id,
      d.contrato_id,
      d.caso_id,
      'despesa',
      d.origem_id,
      d.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      d.valor_informado,
      0,
      jsonb_build_object(
        'cliente_id', d.cliente_id,
        'cliente_nome', d.cliente_nome,
        'contrato_id', d.contrato_id,
        'contrato_numero', d.contrato_numero,
        'contrato_nome', d.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', d.caso_numero,
        'caso_nome', d.caso_nome,
        'regra_nome', 'Despesa',
        'regra_cobranca', 'despesa',
        'categoria', d.categoria,
        'descricao', COALESCE(d.descricao, d.categoria, 'Despesa'),
        'origem', 'despesa'
      ),
      p_user_id,
      p_user_id
    FROM eligible_despesas d
    RETURNING origem_id
  )
  SELECT COUNT(*)::int INTO v_items_count
  FROM inserted_despesas;

  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;

  UPDATE operations.despesas d
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE d.tenant_id = v_tenant_id
    AND d.id IN (SELECT origem_id FROM finance.billing_items WHERE tenant_id = v_tenant_id AND billing_batch_id = v_batch_id AND origem_tipo = 'despesa')
    AND d.status = 'em_lancamento';

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  );
END;
$function$;

-- public.update_despesa — editar despesa
CREATE OR REPLACE FUNCTION public.update_despesa(p_user_id uuid, p_despesa_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_current operations.despesas%ROWTYPE;
  v_is_admin boolean := false;
  v_valor numeric(14,2);
  v_lote_id uuid;
  v_troca_lote boolean := false;
  v_remove_arquivo boolean := false;
  v_so_anexos boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT * INTO v_current
  FROM operations.despesas d
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id AND d.apagado_em IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  v_remove_arquivo := COALESCE((p_payload->>'arquivo_remove')::boolean, false);

  -- O payload mexe SO em anexos? (comprovante principal + adicionais). Se sim,
  -- a despesa aprovada cede; qualquer outra chave a mantem travada.
  SELECT COALESCE(bool_and(k IN (
    'id','arquivo_remove','arquivo_base64','arquivo_nome','mime_type','tamanho_bytes',
    'anexos_remove','anexos_extra_add'
  )), false)
  INTO v_so_anexos
  FROM jsonb_object_keys(p_payload) k;

  IF v_current.status = 'aprovado' AND NOT v_so_anexos THEN
    RAISE EXCEPTION 'Despesa aprovada não pode ser alterada';
  END IF;

  v_is_admin := COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  IF v_current.status <> 'em_lancamento'
     AND v_current.status <> 'aprovado'
     AND v_current.created_by <> p_user_id
     AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Despesa só pode ser editada em lançamento pelo criador';
  END IF;

  IF p_payload ? 'valor' THEN
    v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
    IF v_valor <= 0 THEN
      RAISE EXCEPTION 'Valor da despesa é obrigatório e deve ser maior que zero';
    END IF;
  END IF;

  -- Trocar de lote so vale para lote proprio e aberto. Sair do lote (nulo) e
  -- sempre permitido: a despesa volta a ser um lancamento comum.
  v_troca_lote := p_payload ? 'lote_id';
  IF v_troca_lote THEN
    v_lote_id := NULLIF(p_payload->>'lote_id', '')::uuid;
    PERFORM operations.validar_lote_da_despesa(v_lote_id, p_user_id, v_tenant_id);
  END IF;

  -- Despesa de lote ja validado nao muda: o saldo dela virou lancamento.
  IF v_current.lote_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM operations.despesa_lotes l
    WHERE l.id = v_current.lote_id AND l.status IN ('em_validacao', 'fechado')
  ) THEN
    RAISE EXCEPTION 'Lote já foi fechado: reabra o lote para alterar esta despesa';
  END IF;

  UPDATE operations.despesas d
  SET
    cliente_id = COALESCE((
      SELECT c.cliente_id FROM contracts.contratos c
      WHERE c.id = d.contrato_id AND c.tenant_id = d.tenant_id LIMIT 1
    ), d.cliente_id),
    data_lancamento = COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, d.data_lancamento),
    categoria = COALESCE(NULLIF(trim(p_payload->>'categoria'), ''), d.categoria),
    valor = CASE WHEN p_payload ? 'valor' THEN v_valor ELSE d.valor END,
    descricao = CASE WHEN p_payload ? 'descricao' THEN COALESCE(p_payload->>'descricao', '') ELSE d.descricao END,
    lote_id = CASE WHEN v_troca_lote THEN v_lote_id ELSE d.lote_id END,
    reembolsavel = CASE WHEN p_payload ? 'reembolsavel' THEN COALESCE((p_payload->>'reembolsavel')::boolean, true) ELSE d.reembolsavel END,
    status = CASE
      WHEN p_payload ? 'status' AND (p_payload->>'status') IN ('em_lancamento', 'revisao', 'aprovado', 'cancelado')
        THEN p_payload->>'status'
      ELSE d.status END,
    -- Substituir (base64 novo) ganha de remover. Remover zera. Senao, mantem.
    arquivo_nome = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN COALESCE(NULLIF(trim(p_payload->>'arquivo_nome'), ''), d.arquivo_nome)
      WHEN v_remove_arquivo THEN NULL
      ELSE d.arquivo_nome END,
    mime_type = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'mime_type', '')
      WHEN v_remove_arquivo THEN NULL
      ELSE d.mime_type END,
    tamanho_bytes = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'tamanho_bytes', '')::bigint
      WHEN v_remove_arquivo THEN NULL
      ELSE d.tamanho_bytes END,
    arquivo = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN decode(p_payload->>'arquivo_base64', 'base64')
      WHEN v_remove_arquivo THEN NULL
      ELSE d.arquivo END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

  -- Remover anexos adicionais selecionados
  IF jsonb_typeof(p_payload->'anexos_remove') = 'array' THEN
    DELETE FROM operations.despesa_anexos a
    WHERE a.despesa_id = p_despesa_id AND a.tenant_id = v_tenant_id
      AND a.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(p_payload->'anexos_remove') e);
  END IF;

  -- Adicionar novos anexos
  IF jsonb_typeof(p_payload->'anexos_extra_add') = 'array' THEN
    INSERT INTO operations.despesa_anexos (tenant_id, despesa_id, arquivo, arquivo_nome, mime_type, tamanho_bytes)
    SELECT v_tenant_id, p_despesa_id,
      decode(e->>'arquivo_base64', 'base64'),
      trim(e->>'arquivo_nome'),
      NULLIF(e->>'mime_type', ''),
      NULLIF(e->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_payload->'anexos_extra_add') e
    WHERE COALESCE(NULLIF(trim(e->>'arquivo_base64'), ''), '') <> ''
      AND COALESCE(NULLIF(trim(e->>'arquivo_nome'), ''), '') <> '';
  END IF;

  RETURN jsonb_build_object('id', p_despesa_id);
END;
$function$;

-- operations.saldo_lote_despesa — saldo do lote
CREATE OR REPLACE FUNCTION operations.saldo_lote_despesa(p_lote_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT l.valor - COALESCE((
    SELECT sum(d.valor) FROM operations.despesas d
    WHERE d.lote_id = l.id AND d.status <> 'cancelado' AND d.apagado_em IS NULL
  ), 0)
  FROM operations.despesa_lotes l
  WHERE l.id = p_lote_id;
$function$;

-- public.get_lotes_despesa — qtd. de despesas do lote
CREATE OR REPLACE FUNCTION public.get_lotes_despesa(p_user_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_ve_todos boolean := false;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Quem cuida do financeiro ve os lotes de todo mundo; as demais pessoas veem
  -- apenas os proprios, que e o que elas precisam para lancar.
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.contas_pagar.read', 'finance.contas_pagar.write',
      'finance.contas_pagar.*', 'finance.*', '*',
      'operations.despesa_lotes.manage'
    )
  ) INTO v_ve_todos;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'colaborador_user_id', l.colaborador_user_id,
        'colaborador_nome', col.nome,
        'valor', l.valor,
        'descricao', l.descricao,
        'status', l.status,
        'saldo', operations.saldo_lote_despesa(l.id),
        'total_gasto', l.valor - operations.saldo_lote_despesa(l.id),
        'qtd_despesas', (
          SELECT count(*) FROM operations.despesas d
          WHERE d.lote_id = l.id AND d.status <> 'cancelado' AND d.apagado_em IS NULL
        ),
        'conta_bancaria_origem_id', l.conta_bancaria_origem_id,
        'conta_origem_descricao', bo.descricao,
        'conta_bancaria_destino_id', l.conta_bancaria_destino_id,
        'conta_destino_descricao', bd.descricao,
        'data_transferencia', l.data_transferencia,
        'lancamento_acerto_id', l.lancamento_acerto_id,
        'fechamento_solicitado_em', l.fechamento_solicitado_em,
        'validado_em', l.validado_em,
        'observacao_validacao', l.observacao_validacao,
        'created_at', l.created_at
      )
      ORDER BY l.created_at DESC
    )
    FROM operations.despesa_lotes l
    LEFT JOIN people.colaboradores col
      ON col.user_id = l.colaborador_user_id AND col.tenant_id = l.tenant_id
    LEFT JOIN finance.contas_bancarias bo ON bo.id = l.conta_bancaria_origem_id
    LEFT JOIN finance.contas_bancarias bd ON bd.id = l.conta_bancaria_destino_id
    WHERE l.tenant_id = v_tenant_id
      AND (v_ve_todos OR l.colaborador_user_id = p_user_id)
      AND (NULLIF(p_filtros->>'status','') IS NULL OR l.status = p_filtros->>'status')
      AND (NULLIF(p_filtros->>'colaborador_user_id','') IS NULL
           OR l.colaborador_user_id = (p_filtros->>'colaborador_user_id')::uuid)
  ), '[]'::jsonb);
END;
$function$;

-- public.cancelar_lote_despesa — cancelar lote
CREATE OR REPLACE FUNCTION public.cancelar_lote_despesa(p_user_id uuid, p_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
  v_qtd_despesas int;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar lote de despesas';
  END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_lote.status <> 'aberto' THEN
    RAISE EXCEPTION 'Só é possível cancelar um lote aberto';
  END IF;

  SELECT count(*) INTO v_qtd_despesas
  FROM operations.despesas d WHERE d.lote_id = p_lote_id AND d.status <> 'cancelado' AND d.apagado_em IS NULL;
  IF v_qtd_despesas > 0 THEN
    RAISE EXCEPTION 'Lote tem % despesa(s) lançada(s) — feche e valide em vez de cancelar', v_qtd_despesas;
  END IF;

  IF v_lote.lancamento_adiantamento_id IS NOT NULL THEN
    UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
    WHERE id = v_lote.lancamento_adiantamento_id AND tenant_id = v_tenant_id;
  END IF;

  UPDATE operations.despesa_lotes
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE id = p_lote_id;

  RETURN jsonb_build_object('id', p_lote_id, 'status', 'cancelado');
END;
$function$;


-- ---------------------------------------------------------------------
-- 7. Conferência: toda função que lê operations.timesheets/despesas tem o
--    filtro apagado_em ou está na lista de quem não precisa dele. Função
--    nova ou alterada entre a auditoria (21/10) e a aplicação aborta aqui.
-- ---------------------------------------------------------------------
DO $guard$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY 1)
  INTO v_faltando
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.prokind IN ('f', 'p')
    AND pg_get_functiondef(p.oid) ~* 'operations\.(timesheets|despesas)\M'
    AND pg_get_functiondef(p.oid) !~* 'apagado_em'
    AND (n.nspname || '.' || p.proname) NOT IN (
      'public.get_revisao_fatura',
      'public.get_composicao_fatura',
      'public.update_revisao_fatura_item',
      'public.transferir_billing_item_caso',
      'public.excluir_kit',
      'public.bol_devolver_itens_da_nota',
      'finance.recalcular_valores_hora_do_caso',
      'contracts.recalcular_aprovados_apos_regra',
      'finance.sync_despesa_status_from_billing_item',
      'public.get_despesa_arquivo',
      'public.get_anexos_das_despesas',
      'operations.despesa_sem_comprovante',
      'public.create_timesheet',
      'public.create_despesa'
    );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Lixeira etapa 2: funções leem timesheets/despesas sem o filtro apagado_em: %', v_faltando;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE definition ~* 'operations\.(timesheets|despesas)\M' AND definition !~* 'apagado_em'
    UNION ALL
    SELECT 1 FROM pg_matviews
    WHERE definition ~* 'operations\.(timesheets|despesas)\M' AND definition !~* 'apagado_em'
  ) THEN
    RAISE EXCEPTION 'Lixeira etapa 2: view lê timesheets/despesas sem o filtro apagado_em';
  END IF;
END
$guard$;
