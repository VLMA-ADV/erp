-- =====================================================================
-- Composição da fatura: kit "finalizado" e ajustes (impostos/pagadores)
-- que valem só para o kit (rodada de 24/09 com o Filipe)
--
-- Pedidos do Filipe (24/09):
--   * "Finalizar faturamento" — o e-mail ainda vai manual pelo Gmail, então
--     finalizar é a baixa MANUAL do kit: quem, quando e uma observação. Não
--     muda nada em item, nota ou boleto; é um carimbo por (caso, competência).
--     Reabrir tira o carimbo.
--   * Print 5: "outra PJ paga no lugar da original só naquele mês; o
--     faturamento continua em nome do cliente original, só o pagador mudou".
--     Até aqui o diálogo "Impostos e pagadores" do kit gravava direto no
--     cadastro (aplicar_ajustes_no_cadastro) — ou seja, mudava o caso para
--     todos os meses seguintes. Agora o ajuste mora no kit (finance.kits.ajustes)
--     e só vai para o cadastro quando a pessoa marca "salvar também no
--     cadastro".
--   * 6.1: selecionar vários kits e devolver todos para a revisão de uma vez
--     (excluir_kits), com a mesma trava de NFS-e autorizada / boleto vivo.
--   * 6.2: o relatório de timesheet tem de estar disponível em todo kit que
--     tenha horas — inclusive nos casos mensais/projeto, onde o item de
--     timesheet vale R$ 0. get_composicao_fatura passa a devolver também a
--     contagem de lançamentos (lancamentos_timesheet).
--
-- Objetos:
--   1. tabela finance.kits — uma linha por (tenant, contrato, caso, competência)
--   2. finance._kit_upsert(...)      — acha/cria a linha do kit
--   3. public.finalizar_kit(...)     / public.reabrir_kit(...)
--   4. public.salvar_ajustes_kit(...)
--   5. public.excluir_kit(...)       — CREATE OR REPLACE: apaga também finance.kits
--   6. public.excluir_kits(...)      — lote
--   7. public.get_composicao_fatura  — CREATE OR REPLACE, mesma assinatura:
--        caso.finalizado, caso.ajustes_kit, caso.ajustes_do_kit,
--        caso.lancamentos_timesheet, status_kit 'finalizado',
--        resumo.por_status.finalizado, p_status_kit = 'finalizado'
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. finance.kits. O kit em si continua sendo derivado dos itens
--    aprovado/faturado (get_composicao_fatura); esta tabela guarda só o que
--    é ESTADO do kit e não cabe em item nenhum: o carimbo de finalizado e os
--    ajustes de imposto/pagador daquela competência.
--
--    Chave: (tenant, contrato, caso, competência). caso_id é NULL no bloco
--    "Sem caso" do contrato, e UNIQUE ignora NULL — por isso o índice único
--    é por expressão, com o uuid zero no lugar do NULL.
--
--    RLS ligado sem policy, como as demais finance.* (20260723120000): só
--    service_role e as RPCs SECURITY DEFINER chegam aqui.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.kits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  contrato_id           uuid NOT NULL REFERENCES contracts.contratos(id) ON DELETE CASCADE,
  caso_id               uuid NULL REFERENCES contracts.casos(id) ON DELETE CASCADE,
  competencia           date NOT NULL,
  finalizado_em         timestamptz NULL,
  finalizado_por        uuid NULL,
  finalizado_obs        text NULL,
  -- { "grupo_imposto_id": uuid|null, "pagadores": [{cliente_id, nome, percentual}]|null }
  -- Mesmo formato de 'ajustes' que emit-nfse aceita no body (AjustesDaNota
  -- do nfse-preview-dialog), com o nome do pagador junto para a tela.
  ajustes               jsonb NULL,
  ajustes_atualizado_em timestamptz NULL,
  ajustes_por           uuid NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kits_competencia_primeiro_dia CHECK (competencia = date_trunc('month', competencia)::date),
  CONSTRAINT kits_ajustes_objeto CHECK (ajustes IS NULL OR jsonb_typeof(ajustes) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS kits_chave_uidx
  ON finance.kits (tenant_id, contrato_id,
                   (COALESCE(caso_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                   competencia);

COMMENT ON TABLE finance.kits IS
  'Estado do kit da Composição da fatura por (contrato, caso, competência): finalizado manualmente (Filipe 24/09) e ajustes de imposto/pagador que valem só para aquela competência.';

ALTER TABLE finance.kits ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. Acha/cria a linha do kit. Só cria quando o kit existe de fato (há item
--    aprovado/faturado do caso na competência): sem isso, finalizar um kit
--    inexistente deixaria carimbo em nada.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance._kit_upsert(
  p_tenant uuid,
  p_contrato_id uuid,
  p_caso_id uuid,
  p_competencia date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'public'
AS $$
DECLARE
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_id uuid;
BEGIN
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos ct WHERE ct.id = p_contrato_id AND ct.tenant_id = p_tenant
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  IF p_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = p_caso_id AND cs.tenant_id = p_tenant AND cs.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado no contrato';
  END IF;
  -- Mesma regra de competência de get_composicao_fatura / excluir_kit.
  IF NOT EXISTS (
    SELECT 1 FROM finance.billing_items bi
     WHERE bi.tenant_id = p_tenant
       AND bi.status IN ('aprovado', 'faturado')
       AND bi.contrato_id = p_contrato_id
       AND bi.caso_id IS NOT DISTINCT FROM p_caso_id
       AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
  ) THEN
    RAISE EXCEPTION 'Kit sem itens aprovados na competência %', to_char(v_competencia, 'MM/YYYY');
  END IF;

  INSERT INTO finance.kits (tenant_id, contrato_id, caso_id, competencia)
  VALUES (p_tenant, p_contrato_id, p_caso_id, v_competencia)
  ON CONFLICT (tenant_id, contrato_id,
               (COALESCE(caso_id, '00000000-0000-0000-0000-000000000000'::uuid)),
               competencia)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION finance._kit_upsert(uuid, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance._kit_upsert(uuid, uuid, uuid, date) TO service_role;

-- ---------------------------------------------------------------------
-- 3. Finalizar / reabrir. Permissão: quem monta o kit (_kit_pode_operar =
--    finance.faturamento.manage, curingas finance.* e *, ou a capacidade
--    sensível finance.nfse.manage).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_kit(
  p_user_id uuid,
  p_contrato_id uuid,
  p_caso_id uuid,
  p_competencia date,
  p_obs text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'people', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_em timestamptz := now();
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para finalizar o kit';
  END IF;

  v_id := finance._kit_upsert(v_tenant, p_contrato_id, p_caso_id, p_competencia);

  UPDATE finance.kits
     SET finalizado_em = v_em,
         finalizado_por = p_user_id,
         finalizado_obs = NULLIF(trim(COALESCE(p_obs, '')), ''),
         updated_at = now()
   WHERE id = v_id;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'kit_id', v_id,
    'finalizado', jsonb_build_object(
      'em', v_em, 'por_nome', COALESCE(v_nome, 'Usuário'),
      'obs', NULLIF(trim(COALESCE(p_obs, '')), ''))
  );
END $$;

REVOKE ALL ON FUNCTION public.finalizar_kit(uuid, uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalizar_kit(uuid, uuid, uuid, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reabrir_kit(
  p_user_id uuid,
  p_contrato_id uuid,
  p_caso_id uuid,
  p_competencia date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_n int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para reabrir o kit';
  END IF;

  -- Só zera o carimbo; a linha fica (pode ter ajustes).
  UPDATE finance.kits
     SET finalizado_em = NULL, finalizado_por = NULL, finalizado_obs = NULL,
         updated_at = now()
   WHERE tenant_id = v_tenant
     AND contrato_id = p_contrato_id
     AND caso_id IS NOT DISTINCT FROM p_caso_id
     AND competencia = v_competencia
     AND finalizado_em IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'reaberto', v_n > 0);
END $$;

REVOKE ALL ON FUNCTION public.reabrir_kit(uuid, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reabrir_kit(uuid, uuid, uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Ajustes do kit (impostos e pagadores). Por padrão valem SÓ para esta
--    competência (print 5 do Filipe); com p_salvar_no_cadastro também
--    gravam no caso/contrato via aplicar_ajustes_no_cadastro (que exige a
--    capacidade finance.nfse.manage — a mesma regra da prévia da NF).
--
--    p_ajustes: { grupo_imposto_id: uuid|null, pagadores: [{cliente_id,
--    percentual}]|null }. Com os dois nulos, limpa o ajuste do kit (volta ao
--    cadastro). Pagadores precisam fechar 100% — mesma checagem do emit-nfse,
--    para o ajuste não ser aceito aqui e recusado na hora de emitir.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_ajustes_kit(
  p_user_id uuid,
  p_contrato_id uuid,
  p_caso_id uuid,
  p_competencia date,
  p_ajustes jsonb,
  p_salvar_no_cadastro boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_grupo_id uuid;
  v_grupo_nome text;
  v_pagadores jsonb;          -- [{cliente_id, nome, percentual}] para o kit
  v_pagadores_cadastro jsonb; -- [{cliente_id, percentual}] para o cadastro
  v_soma numeric;
  v_ajustes jsonb;
  v_cadastro jsonb := NULL;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o kit';
  END IF;
  IF p_ajustes IS NOT NULL AND jsonb_typeof(p_ajustes) <> 'object' THEN
    RAISE EXCEPTION 'Ajustes inválidos';
  END IF;

  -- Grupo de impostos: tem de existir no tenant.
  v_grupo_id := NULLIF(p_ajustes->>'grupo_imposto_id', '')::uuid;
  IF v_grupo_id IS NOT NULL THEN
    SELECT gi.nome INTO v_grupo_nome FROM contracts.grupos_impostos gi
     WHERE gi.id = v_grupo_id AND gi.tenant_id = v_tenant;
    IF v_grupo_nome IS NULL THEN RAISE EXCEPTION 'Grupo de impostos não encontrado'; END IF;
  END IF;

  -- Pagadores: clientes do tenant, percentuais fechando 100%.
  IF jsonb_typeof(p_ajustes->'pagadores') = 'array' AND jsonb_array_length(p_ajustes->'pagadores') > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('cliente_id', pg.cliente_id, 'nome', c.nome, 'percentual', pg.percentual)
                     ORDER BY pg.percentual DESC, c.nome),
           jsonb_agg(jsonb_build_object('cliente_id', pg.cliente_id, 'percentual', pg.percentual)
                     ORDER BY pg.percentual DESC, c.nome),
           sum(pg.percentual)
      INTO v_pagadores, v_pagadores_cadastro, v_soma
      FROM (
        SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
               round(COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 0), 2) AS percentual
          FROM jsonb_array_elements(p_ajustes->'pagadores') p
      ) pg
      LEFT JOIN crm.clientes c ON c.id = pg.cliente_id AND c.tenant_id = v_tenant;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_ajustes->'pagadores') p
      LEFT JOIN crm.clientes c ON c.id = NULLIF(p.value->>'cliente_id', '')::uuid AND c.tenant_id = v_tenant
      WHERE c.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Pagador não encontrado entre os clientes';
    END IF;
    IF abs(v_soma - 100) > 0.01 THEN
      RAISE EXCEPTION 'Os percentuais dos pagadores somam %, precisam somar 100%%', v_soma;
    END IF;
  END IF;

  v_id := finance._kit_upsert(v_tenant, p_contrato_id, p_caso_id, p_competencia);

  v_ajustes := CASE WHEN v_grupo_id IS NULL AND v_pagadores IS NULL THEN NULL
               ELSE jsonb_build_object('grupo_imposto_id', v_grupo_id, 'pagadores', v_pagadores) END;

  UPDATE finance.kits
     SET ajustes = v_ajustes,
         ajustes_atualizado_em = now(),
         ajustes_por = p_user_id,
         updated_at = now()
   WHERE id = v_id;

  IF p_salvar_no_cadastro AND (v_grupo_id IS NOT NULL OR v_pagadores_cadastro IS NOT NULL) THEN
    v_cadastro := public.aplicar_ajustes_no_cadastro(
      p_user_id, p_contrato_id, p_caso_id, v_pagadores_cadastro, v_grupo_id, NULL, NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kit_id', v_id,
    'ajustes_kit', CASE WHEN v_ajustes IS NULL THEN NULL ELSE jsonb_build_object(
      'grupo_imposto_id', v_grupo_id, 'grupo_imposto_nome', v_grupo_nome, 'pagadores', v_pagadores) END,
    'alterado_no_cadastro', (v_cadastro IS NOT NULL
                             AND jsonb_array_length(COALESCE(v_cadastro->'alterado', '[]'::jsonb)) > 0),
    'alterado', COALESCE(v_cadastro->'alterado', '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.salvar_ajustes_kit(uuid, uuid, uuid, date, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_ajustes_kit(uuid, uuid, uuid, date, jsonb, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. excluir_kit: mesma função de 20260923100000; a única mudança é que,
--    ao devolver os itens para a revisão, a linha de finance.kits (carimbo
--    de finalizado + ajustes) vai junto — o kit deixa de existir.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_kit(
  p_user_id uuid,
  p_caso_id uuid,
  p_contrato_id uuid,
  p_competencia date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_item_ids uuid[];
  v_nota record;
  v_nome text;
  v_itens int := 0;
  v_ts int := 0;
  v_docs int := 0;
  v_nf_erro int := 0;
  v_kit int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir o kit';
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;

  -- Itens do kit: aprovado/faturado do caso (ou "Sem caso" do contrato) na
  -- competência — mesma regra de competência de get_revisao_fatura.
  SELECT array_agg(bi.id) INTO v_item_ids
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_tenant
     AND bi.status IN ('aprovado', 'faturado')
     AND bi.contrato_id = p_contrato_id
     AND bi.caso_id IS NOT DISTINCT FROM p_caso_id
     AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0,
                              'motivo', 'Nenhum item aprovado neste kit');
  END IF;

  -- Bloqueio 1: NFS-e autorizada ou em processamento sobre esses itens.
  SELECT bn.id, bn.numero, bn.focus_status,
         COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                  NULLIF(bn.metadata->>'nfse_numero', ''),
                  bn.numero::text) AS nfse_numero
    INTO v_nota
    FROM finance.billing_notes bn
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('autorizado', 'processando')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
       WHERE x.value::uuid = ANY (v_item_ids)
     )
   ORDER BY bn.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0,
      'motivo', CASE WHEN v_nota.focus_status = 'autorizado'
                     THEN 'NFS-e ' || v_nota.nfse_numero || ' autorizada'
                     ELSE 'NFS-e ' || v_nota.nfse_numero || ' em processamento' END);
  END IF;

  -- Bloqueio 2: boleto vivo (registrado/emitido/pago/liquidado) numa conta a
  -- receber de qualquer NFS-e desses itens — inclusive de nota já cancelada,
  -- porque o boleto continua no banco.
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_fiscal_servico'
       AND b.status NOT IN ('cancelado', 'erro', 'baixado')
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
         WHERE x.value::uuid = ANY (v_item_ids)
       )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0, 'motivo', 'Boleto registrado');
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  -- Rastro no histórico do item (mesma tabela que a revisão mostra).
  INSERT INTO finance.revisao_fatura_itens_historico (
    billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
  )
  SELECT bi.id, 'APROVADOR', p_user_id, COALESCE(v_nome, 'Usuário'),
         COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0),
         COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0),
         'Kit excluído da Composição da fatura (competência '
           || to_char(v_competencia, 'MM/YYYY') || '): item devolvido para revisão',
         v_tenant, now()
    FROM finance.billing_items bi
   WHERE bi.id = ANY (v_item_ids);

  -- Volta como 'Liberado' (em_revisao) e limpa a aprovação.
  UPDATE finance.billing_items bi
     SET status = 'em_revisao',
         valor_aprovado = NULL,
         horas_aprovadas = NULL,
         data_aprovacao = NULL,
         responsavel_aprovacao_id = NULL,
         updated_at = now(),
         updated_by = p_user_id
   WHERE bi.id = ANY (v_item_ids);
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE operations.timesheets t
     SET status = 'revisao', updated_at = now(), updated_by = p_user_id
   WHERE t.tenant_id = v_tenant
     AND t.status = 'aprovado'
     AND t.id IN (
       SELECT bi.origem_id FROM finance.billing_items bi
        WHERE bi.id = ANY (v_item_ids) AND bi.origem_tipo = 'timesheet'
     );
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  -- Documentos do kit (relatório de timesheet, nota de débito) saem junto.
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
     AND bn.status = 'gerado'
     AND bn.contrato_id = p_contrato_id
     AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
     AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  -- NFS-e que ficou em erro sobre esses itens: cancela o registro (não é
  -- ato fiscal — nunca chegou a existir na prefeitura).
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('erro', 'erro_autorizacao')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
       WHERE x.value::uuid = ANY (v_item_ids)
     );
  GET DIAGNOSTICS v_nf_erro = ROW_COUNT;

  -- Estado do kit (finalizado / ajustes) some com o kit (24/09).
  DELETE FROM finance.kits k
   WHERE k.tenant_id = v_tenant
     AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id
     AND k.competencia = v_competencia;
  GET DIAGNOSTICS v_kit = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'itens_devolvidos', v_itens,
    'horas_devolvidas', v_ts,
    'documentos_cancelados', v_docs,
    'nfse_erro_canceladas', v_nf_erro,
    'kit_apagado', v_kit > 0,
    'motivo', NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.excluir_kit(uuid, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_kit(uuid, uuid, uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. 6.1: excluir vários kits de uma vez. p_kits = [{contrato_id, caso_id,
--    competencia}]. Cada kit passa pela excluir_kit (mesmas travas); o que
--    for recusado volta em 'recusados' com o motivo e os demais seguem —
--    um kit travado não pode segurar a devolução dos outros. Erro
--    inesperado num kit também vira recusa (SQLERRM), sem derrubar o lote.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_kits(
  p_user_id uuid,
  p_kits jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_k jsonb;
  v_res jsonb;
  v_devolvidos int := 0;
  v_recusados jsonb := '[]'::jsonb;
  v_contrato uuid;
  v_caso uuid;
  v_comp date;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir kits';
  END IF;
  IF p_kits IS NULL OR jsonb_typeof(p_kits) <> 'array' THEN
    RAISE EXCEPTION 'Lista de kits inválida';
  END IF;

  FOR v_k IN SELECT value FROM jsonb_array_elements(p_kits) LOOP
    v_contrato := NULLIF(v_k->>'contrato_id', '')::uuid;
    v_caso := NULLIF(v_k->>'caso_id', '')::uuid;
    v_comp := NULLIF(v_k->>'competencia', '')::date;
    BEGIN
      v_res := public.excluir_kit(p_user_id, v_caso, v_contrato, v_comp);
    EXCEPTION WHEN OTHERS THEN
      v_res := jsonb_build_object('ok', false, 'motivo', SQLERRM);
    END;

    IF COALESCE((v_res->>'ok')::boolean, false) THEN
      v_devolvidos := v_devolvidos + 1;
    ELSE
      v_recusados := v_recusados || jsonb_build_object(
        'contrato_id', v_contrato, 'caso_id', v_caso, 'competencia', v_comp,
        'motivo', COALESCE(v_res->>'motivo', 'Não foi possível excluir'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'devolvidos', v_devolvidos, 'recusados', v_recusados);
END $$;

REVOKE ALL ON FUNCTION public.excluir_kits(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_kits(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. get_composicao_fatura — mesma assinatura e mesma montagem de
--    20260923100000, com:
--      * finance.kits entrando por (contrato, caso, competência):
--          caso.finalizado    = {em, por_nome, obs} | null
--          caso.ajustes_kit   = {grupo_imposto_id, grupo_imposto_nome, pagadores} | null
--          caso.ajustes_do_kit = true quando grupo_imposto/pagadores do caso
--                               vieram do ajuste do kit (e não do cadastro)
--      * status_kit 'finalizado': acima de pendente/nf_emitida/enviado;
--        'recebido' continua acima de tudo (dinheiro na conta é fato, não
--        carimbo). resumo.por_status ganha 'finalizado'; p_status_kit filtra.
--      * caso.lancamentos_timesheet = quantidade de itens de timesheet do
--        kit. caso.horas já somava TODOS os itens de timesheet (inclusive
--        os de R$ 0 em mensal/projeto) — o front é que só mostrava o
--        relatório com horas > 0; agora tem a contagem para o texto
--        "Nh em M lançamento(s)".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_composicao_fatura(
  p_user_id uuid,
  p_competencia date DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL,
  p_contrato_id uuid DEFAULT NULL,
  p_caso_id uuid DEFAULT NULL,
  p_regra text DEFAULT NULL,
  p_status_kit text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'crm', 'people', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_regra text := NULLIF(trim(COALESCE(p_regra, '')), '');
  v_status text := NULLIF(trim(COALESCE(p_status_kit, '')), '');
  v_out jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.read', 'finance.faturamento.manage',
                               'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver a composição da fatura';
  END IF;

  WITH itens AS (
    SELECT bi.id, bi.contrato_id, bi.caso_id, bi.origem_tipo, bi.status,
           bi.data_referencia, bi.snapshot, bi.created_at,
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date AS competencia,
           -- Mesmo valor que vai na NFS-e (get_billing_items_aprovados_full).
           COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)::numeric AS valor,
           -- Horas de TODO item de timesheet, valha ele R$ 0 ou não (6.2).
           CASE WHEN bi.origem_tipo = 'timesheet'
                THEN COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0)
                ELSE 0 END::numeric AS horas
      FROM finance.billing_items bi
     WHERE bi.tenant_id = v_tenant
       AND bi.status IN ('aprovado', 'faturado')
  ),
  itens_chave AS (
    SELECT i.*,
           COALESCE(i.caso_id::text, 'contrato:' || i.contrato_id::text) || '|' || i.competencia::text AS chave
      FROM itens i
  ),
  kits AS (
    SELECT ic.chave, ic.caso_id, ic.contrato_id, ic.competencia,
           array_agg(ic.id) AS item_ids,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN 0 ELSE ic.valor END), 2) AS valor_servico,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN ic.valor ELSE 0 END), 2) AS valor_despesa,
           round(sum(ic.horas), 2) AS horas,
           count(*) FILTER (WHERE ic.origem_tipo = 'timesheet') AS lancamentos_timesheet,
           round(sum(ic.valor), 2) AS valor_total
      FROM itens_chave ic
     GROUP BY ic.chave, ic.caso_id, ic.contrato_id, ic.competencia
  ),
  -- (nota NFS-e, item) para cruzar com os kits sem varrer jsonb por kit.
  nota_itens AS (
    SELECT bn.id AS nota_id, x.value::uuid AS item_id
      FROM finance.billing_notes bn
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_fiscal_servico'
  ),
  kit_notas AS (
    SELECT DISTINCT ic.chave, ni.nota_id
      FROM itens_chave ic
      JOIN nota_itens ni ON ni.item_id = ic.id
  ),
  -- A NFS-e "do kit": a viva (gerado) primeiro, depois a mais recente.
  kit_nfse AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, bn.id, bn.numero, bn.status, bn.focus_status,
           bn.arquivo_nome, bn.arquivo_url, bn.created_at,
           COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                    NULLIF(bn.metadata->>'nfse_numero', '')) AS nfse_numero,
           NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total
      FROM kit_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
     ORDER BY kn.chave, (bn.status = 'gerado') DESC, bn.created_at DESC
  ),
  -- Conta a receber da NFS-e do kit (cancelada por último, como em Notas geradas).
  kit_lanc AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nfse kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.id
     ORDER BY kn.chave, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_boleto AS (
    SELECT DISTINCT ON (kl.chave)
           kl.chave, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_lanc kl
      JOIN finance.boletos b ON b.lancamento_id = kl.id
     ORDER BY kl.chave, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  -- D11: boleto vivo em QUALQUER nota desses itens (até de nota cancelada) trava o kit.
  kit_boleto_vivo AS (
    SELECT DISTINCT kn.chave
      FROM kit_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE b.status NOT IN ('cancelado', 'erro', 'baixado')
  ),
  kit_envio AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, e.enviado_em, e.destinatario, e.erro, c.nome AS por,
           count(*) OVER (PARTITION BY kn.chave) AS total,
           bool_or(e.erro IS NULL) OVER (PARTITION BY kn.chave) AS algum_ok
      FROM kit_nfse kn
      JOIN finance.fatura_envios e ON e.tenant_id = v_tenant AND e.billing_note_id = kn.id
      LEFT JOIN people.colaboradores c ON c.user_id = e.enviado_por AND c.tenant_id = v_tenant
     ORDER BY kn.chave, e.enviado_em DESC
  ),
  -- Relatório de timesheet / nota de débito registrados (D12-a), por kit.
  kit_docs AS (
    SELECT DISTINCT ON (k.chave, bn.tipo_documento)
           k.chave, bn.tipo_documento, bn.id, bn.created_at, bn.arquivo_nome, bn.arquivo_url,
           COALESCE(NULLIF(bn.metadata->>'gerado_por_nome', ''), c.nome) AS gerado_por
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
       AND bn.status = 'gerado'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
      LEFT JOIN people.colaboradores c ON c.user_id = bn.created_by AND c.tenant_id = v_tenant
     ORDER BY k.chave, bn.tipo_documento, bn.created_at DESC
  ),
  -- Estado do kit (24/09): carimbo de finalizado e ajustes desta competência.
  -- Nome do pagador e do grupo resolvidos na hora (o cadastro pode ter mudado
  -- depois que o ajuste foi salvo).
  kit_estado AS (
    SELECT k.chave,
           fk.finalizado_em, fk.finalizado_obs,
           COALESCE(cf.nome, 'Usuário') AS finalizado_por_nome,
           NULLIF(fk.ajustes->>'grupo_imposto_id', '')::uuid AS aj_grupo_id,
           gia.nome AS aj_grupo_nome,
           CASE WHEN jsonb_typeof(fk.ajustes->'pagadores') = 'array'
                 AND jsonb_array_length(fk.ajustes->'pagadores') > 0
                THEN (
                  SELECT jsonb_agg(jsonb_build_object(
                           'cliente_id', pg.cliente_id, 'nome', pc.nome, 'percentual', pg.percentual)
                         ORDER BY pg.percentual DESC, pc.nome)
                    FROM (
                      SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
                             COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 100) AS percentual
                        FROM jsonb_array_elements(fk.ajustes->'pagadores') p
                    ) pg
                    LEFT JOIN crm.clientes pc ON pc.id = pg.cliente_id)
                ELSE NULL END AS aj_pagadores
      FROM kits k
      JOIN finance.kits fk
        ON fk.tenant_id = v_tenant
       AND fk.contrato_id = k.contrato_id
       AND fk.caso_id IS NOT DISTINCT FROM k.caso_id
       AND fk.competencia = k.competencia
      LEFT JOIN people.colaboradores cf ON cf.user_id = fk.finalizado_por AND cf.tenant_id = v_tenant
      LEFT JOIN contracts.grupos_impostos gia ON gia.id = NULLIF(fk.ajustes->>'grupo_imposto_id', '')::uuid
  ),
  kit_full AS (
    SELECT k.*,
           ct.cliente_id, cli.nome AS cliente_nome,
           ct.numero AS contrato_numero, ct.nome_contrato AS contrato_nome,
           cs.numero AS caso_numero, cs.nome AS caso_nome,
           COALESCE(cs.enviar_relatorio_timesheet, false) AS enviar_relatorio_timesheet,
           COALESCE(
             NULLIF(cs.regra_cobranca, ''),
             (SELECT NULLIF(r->>'regra_cobranca', '')
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                                               THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
               WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
                 AND NULLIF(r->>'regra_cobranca', '') IS NOT NULL
               LIMIT 1)
           ) AS regra_cobranca,
           -- Grupo/pagadores do CADASTRO (contrato/caso)...
           CASE WHEN gi.id IS NULL THEN NULL
                ELSE jsonb_build_object('id', gi.id, 'nome', gi.nome) END AS grupo_imposto_cadastro,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'cliente_id', pg.cliente_id, 'nome', pc.nome, 'percentual', pg.percentual)
                    ORDER BY pg.percentual DESC, pc.nome)
               FROM (
                 SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
                        COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 100) AS percentual
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(cs.pagadores_servico) = 'array'
                                AND jsonb_array_length(cs.pagadores_servico) > 0
                               THEN cs.pagadores_servico
                               ELSE jsonb_build_array(jsonb_build_object('cliente_id', ct.cliente_id, 'percentual', 100))
                          END) p
               ) pg
               LEFT JOIN crm.clientes pc ON pc.id = pg.cliente_id
           ), '[]'::jsonb) AS pagadores_cadastro,
           -- ...e o ajuste do kit, quando houver (print 5: vale só neste mês).
           ke.finalizado_em, ke.finalizado_por_nome, ke.finalizado_obs,
           ke.aj_grupo_id, ke.aj_grupo_nome, ke.aj_pagadores,
           nf.id AS nfse_id, nf.numero AS nfse_numero_interno, nf.nfse_numero, nf.status AS nfse_status,
           nf.focus_status AS nfse_focus_status, nf.arquivo_nome AS nfse_arquivo_nome,
           nf.arquivo_url AS nfse_arquivo_url, nf.valor_total AS nfse_valor_total,
           nf.created_at AS nfse_created_at,
           bo.id AS boleto_id, bo.status AS boleto_status, bo.vencimento AS boleto_vencimento,
           bo.valor AS boleto_valor, bo.linha_digitavel, bo.nosso_numero, bo.pix_copia_cola,
           l.id AS lanc_id, l.status AS lanc_status, l.valor AS lanc_valor,
           l.vencimento AS lanc_vencimento, l.baixa_data AS lanc_baixa_data,
           env.enviado_em, env.destinatario, env.por AS envio_por, env.erro AS envio_erro,
           env.total AS envio_total, COALESCE(env.algum_ok, false) AS envio_ok,
           (bv.chave IS NOT NULL) AS boleto_vivo,
           CASE
             WHEN l.status IN ('pago', 'recebido') OR l.baixa_data IS NOT NULL THEN 'recebido'
             WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
             WHEN COALESCE(env.algum_ok, false) THEN 'enviado'
             WHEN nf.status = 'gerado' AND nf.focus_status IN ('autorizado', 'processando') THEN 'nf_emitida'
             ELSE 'pendente'
           END AS status_kit
      FROM kits k
      JOIN contracts.contratos ct ON ct.id = k.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      LEFT JOIN contracts.casos cs ON cs.id = k.caso_id
      LEFT JOIN contracts.grupos_impostos gi ON gi.id = ct.grupo_imposto_id
      LEFT JOIN kit_nfse nf ON nf.chave = k.chave
      LEFT JOIN kit_lanc l ON l.chave = k.chave
      LEFT JOIN kit_boleto bo ON bo.chave = k.chave
      LEFT JOIN kit_envio env ON env.chave = k.chave
      LEFT JOIN kit_boleto_vivo bv ON bv.chave = k.chave
      LEFT JOIN kit_estado ke ON ke.chave = k.chave
  ),
  filtrado AS (
    SELECT kf.*,
           CASE
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status = 'autorizado'
               THEN 'NFS-e ' || COALESCE(kf.nfse_numero, kf.nfse_numero_interno::text) || ' autorizada'
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status = 'processando'
               THEN 'NFS-e ' || COALESCE(kf.nfse_numero, kf.nfse_numero_interno::text) || ' em processamento'
             WHEN kf.boleto_vivo THEN 'Boleto registrado'
             ELSE NULL
           END AS motivo_bloqueio,
           (kf.aj_grupo_id IS NOT NULL OR kf.aj_pagadores IS NOT NULL) AS ajustes_do_kit,
           -- O que a NFS-e vai usar: o ajuste do kit manda sobre o cadastro.
           CASE WHEN kf.aj_grupo_id IS NOT NULL
                THEN jsonb_build_object('id', kf.aj_grupo_id, 'nome', kf.aj_grupo_nome)
                ELSE kf.grupo_imposto_cadastro END AS grupo_imposto,
           COALESCE(kf.aj_pagadores, kf.pagadores_cadastro) AS pagadores
      FROM kit_full kf
     WHERE (v_competencia IS NULL OR kf.competencia = v_competencia)
       AND (p_cliente_id IS NULL OR kf.cliente_id = p_cliente_id)
       AND (p_contrato_id IS NULL OR kf.contrato_id = p_contrato_id)
       AND (p_caso_id IS NULL OR kf.caso_id = p_caso_id)
       AND (v_regra IS NULL OR kf.regra_cobranca = v_regra)
       AND (v_status IS NULL OR kf.status_kit = v_status)
  ),
  itens_json AS (
    SELECT ic.chave,
           jsonb_agg(jsonb_build_object(
             'id', ic.id,
             'origem_tipo', ic.origem_tipo,
             'descricao', CASE ic.origem_tipo
               WHEN 'timesheet' THEN COALESCE(NULLIF(ic.snapshot->>'timesheet_descricao', ''), 'Timesheet')
               WHEN 'despesa'   THEN COALESCE(NULLIF(ic.snapshot->>'descricao', ''), 'Despesa')
               ELSE COALESCE(NULLIF(ic.snapshot->>'regra_nome', ''),
                             NULLIF(ic.snapshot->>'descricao', ''),
                             NULLIF(ic.snapshot->>'regra_cobranca', ''),
                             'Regra financeira')
             END,
             'data_referencia', ic.data_referencia,
             'horas', ic.horas,
             'valor', ic.valor,
             'status', ic.status,
             'linhas_timesheet', CASE WHEN ic.origem_tipo <> 'timesheet' THEN '[]'::jsonb ELSE
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'data', COALESCE(NULLIF(r->>'data_lancamento', ''), ic.snapshot->>'timesheet_data_lancamento'),
                          'profissional', COALESCE(NULLIF(r->>'profissional', ''), ic.snapshot->>'timesheet_profissional'),
                          'cargo', NULLIF(r->>'cargo', ''),
                          'descricao', COALESCE(NULLIF(r->>'atividade', ''), NULLIF(r->>'descricao', ''), ic.snapshot->>'timesheet_descricao'),
                          'horas', lh.horas,
                          'valor_hora', lh.valor_hora,
                          'valor', round(lh.horas * lh.valor_hora, 2)
                        ) ORDER BY NULLIF(r->>'data_lancamento', '')::date NULLS LAST)
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(ic.snapshot->'timesheet_itens_revisao') = 'array'
                               THEN ic.snapshot->'timesheet_itens_revisao' ELSE '[]'::jsonb END) r
                   CROSS JOIN LATERAL (
                     SELECT COALESCE(NULLIF(r->>'horas_revisadas', '')::numeric,
                                     NULLIF(r->>'horas', '')::numeric,
                                     NULLIF(r->>'horas_iniciais', '')::numeric, 0) AS horas,
                            COALESCE(NULLIF(r->>'valor_hora', '')::numeric, 0) AS valor_hora
                   ) lh
               ), jsonb_build_array(jsonb_build_object(
                    'data', ic.snapshot->>'timesheet_data_lancamento',
                    'profissional', ic.snapshot->>'timesheet_profissional',
                    'cargo', NULL,
                    'descricao', ic.snapshot->>'timesheet_descricao',
                    'horas', ic.horas,
                    'valor_hora', COALESCE(NULLIF(ic.snapshot->>'timesheet_valor_hora', '')::numeric,
                                           NULLIF(ic.snapshot->>'valor_hora', '')::numeric,
                                           CASE WHEN ic.horas > 0 THEN round(ic.valor / ic.horas, 2) ELSE 0 END),
                    'valor', ic.valor)))
             END,
             'despesa', CASE WHEN ic.origem_tipo <> 'despesa' THEN NULL ELSE jsonb_build_object(
               'data', COALESCE(NULLIF(ic.snapshot->'valor_itens_revisao'->0->>'referencia', ''), ic.data_referencia::text),
               'categoria', NULLIF(ic.snapshot->>'categoria', ''),
               'descricao', NULLIF(ic.snapshot->>'descricao', ''),
               'valor', ic.valor) END
           ) ORDER BY ic.data_referencia NULLS LAST, ic.created_at) AS itens
      FROM itens_chave ic
     WHERE ic.chave IN (SELECT f.chave FROM filtrado f)
     GROUP BY ic.chave
  ),
  casos_json AS (
    SELECT f.cliente_id, f.cliente_nome, f.valor_total, f.contrato_numero, f.caso_numero,
           jsonb_build_object(
             'chave', f.chave,
             'caso_id', f.caso_id,
             'caso_numero', f.caso_numero,
             'caso_nome', COALESCE(f.caso_nome, 'Sem caso'),
             'regra_cobranca', f.regra_cobranca,
             'contrato_id', f.contrato_id,
             'contrato_numero', f.contrato_numero,
             'contrato_nome', f.contrato_nome,
             'competencia', f.competencia,
             'enviar_relatorio_timesheet', f.enviar_relatorio_timesheet,
             'grupo_imposto', f.grupo_imposto,
             'pagadores', f.pagadores,
             'ajustes_do_kit', f.ajustes_do_kit,
             'ajustes_kit', CASE WHEN NOT f.ajustes_do_kit THEN NULL ELSE jsonb_build_object(
               'grupo_imposto_id', f.aj_grupo_id,
               'grupo_imposto_nome', f.aj_grupo_nome,
               'pagadores', f.aj_pagadores) END,
             'finalizado', CASE WHEN f.finalizado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'em', f.finalizado_em, 'por_nome', f.finalizado_por_nome, 'obs', f.finalizado_obs) END,
             'valor_servico', f.valor_servico,
             'valor_despesa', f.valor_despesa,
             'horas', f.horas,
             'lancamentos_timesheet', f.lancamentos_timesheet,
             'valor_total', f.valor_total,
             'itens', COALESCE(ij.itens, '[]'::jsonb),
             'documentos', jsonb_build_object(
               'nfse', CASE WHEN f.nfse_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', f.nfse_id, 'numero', f.nfse_numero_interno, 'nfse_numero', f.nfse_numero,
                 'status', f.nfse_status, 'focus_status', f.nfse_focus_status,
                 'arquivo_nome', f.nfse_arquivo_nome, 'arquivo_url', f.nfse_arquivo_url,
                 'valor_total', f.nfse_valor_total, 'created_at', f.nfse_created_at) END,
               'boleto', CASE WHEN f.boleto_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', f.boleto_id, 'status', f.boleto_status, 'vencimento', f.boleto_vencimento,
                 'valor', f.boleto_valor, 'linha_digitavel', f.linha_digitavel,
                 'nosso_numero', f.nosso_numero, 'pix_emv', f.pix_copia_cola) END,
               'relatorio_timesheet', (
                 SELECT jsonb_build_object('id', d.id, 'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'relatorio_timesheet'),
               'nota_debito', (
                 SELECT jsonb_build_object('id', d.id, 'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'nota_debito')
             ),
             'envio', CASE WHEN f.enviado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'enviado_em', f.enviado_em, 'destinatario', f.destinatario, 'por', f.envio_por,
               'erro', f.envio_erro, 'total', f.envio_total) END,
             'conta_receber', CASE WHEN f.lanc_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', f.lanc_id, 'status', f.lanc_status, 'valor', f.lanc_valor,
               'vencimento', f.lanc_vencimento, 'pago_em', f.lanc_baixa_data) END,
             'status_kit', f.status_kit,
             'pode_excluir', (f.motivo_bloqueio IS NULL),
             'motivo_bloqueio', f.motivo_bloqueio
           ) AS caso
      FROM filtrado f
      LEFT JOIN itens_json ij ON ij.chave = f.chave
  ),
  clientes_json AS (
    SELECT cj.cliente_id, cj.cliente_nome,
           jsonb_build_object(
             'cliente_id', cj.cliente_id,
             'nome', COALESCE(cj.cliente_nome, 'Cliente sem nome'),
             'valor_total', round(sum(cj.valor_total), 2),
             'kits', count(*),
             'casos', jsonb_agg(cj.caso ORDER BY cj.contrato_numero NULLS LAST, cj.caso_numero NULLS LAST)
           ) AS cliente
      FROM casos_json cj
     GROUP BY cj.cliente_id, cj.cliente_nome
  )
  SELECT jsonb_build_object(
    'resumo', jsonb_build_object(
      'kits', (SELECT count(*) FROM filtrado),
      'valor_total', (SELECT COALESCE(round(sum(valor_total), 2), 0) FROM filtrado),
      'por_status', (
        SELECT jsonb_object_agg(s.status, jsonb_build_object(
                 'kits', COALESCE(t.kits, 0), 'valor', COALESCE(t.valor, 0)))
          FROM (VALUES ('pendente'), ('nf_emitida'), ('enviado'), ('finalizado'), ('recebido')) s(status)
          LEFT JOIN (
            SELECT f.status_kit, count(*) AS kits, round(sum(f.valor_total), 2) AS valor
              FROM filtrado f GROUP BY f.status_kit
          ) t ON t.status_kit = s.status
      )
    ),
    'opcoes', jsonb_build_object(
      'competencias', COALESCE((SELECT jsonb_agg(c ORDER BY c DESC)
                                  FROM (SELECT DISTINCT competencia AS c FROM kit_full) z), '[]'::jsonb),
      'clientes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.cliente_id, 'nome', z.cliente_nome) ORDER BY z.cliente_nome)
                              FROM (SELECT DISTINCT cliente_id, cliente_nome FROM kit_full WHERE cliente_id IS NOT NULL) z), '[]'::jsonb),
      'contratos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.contrato_id, 'numero', z.contrato_numero,
                                                                  'nome', z.contrato_nome, 'cliente_id', z.cliente_id)
                                              ORDER BY z.contrato_numero NULLS LAST)
                               FROM (SELECT DISTINCT contrato_id, contrato_numero, contrato_nome, cliente_id FROM kit_full) z), '[]'::jsonb),
      'casos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.caso_id, 'numero', z.caso_numero,
                                                              'nome', z.caso_nome, 'contrato_id', z.contrato_id)
                                          ORDER BY z.caso_numero NULLS LAST)
                           FROM (SELECT DISTINCT caso_id, caso_numero, caso_nome, contrato_id FROM kit_full WHERE caso_id IS NOT NULL) z), '[]'::jsonb),
      'regras', COALESCE((SELECT jsonb_agg(r ORDER BY r)
                            FROM (SELECT DISTINCT regra_cobranca AS r FROM kit_full WHERE regra_cobranca IS NOT NULL) z), '[]'::jsonb)
    ),
    'clientes', COALESCE((SELECT jsonb_agg(c.cliente ORDER BY c.cliente_nome NULLS LAST) FROM clientes_json c), '[]'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.get_composicao_fatura(uuid, date, uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_composicao_fatura(uuid, date, uuid, uuid, uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
