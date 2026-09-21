-- =====================================================================
-- Composição da fatura: kit por CASO e competência (lote C, backend)
--
-- Decisões do Filipe em 21/09 sobre a tela de Composição da fatura:
--   D10-a  "Zerar kits de teste" limpa só kits sem NFS-e autorizada e sem
--          boleto registrado — e sempre por kit, nunca geral.
--   D11-a  "Excluir este kit" devolve os itens para a revisão (voltam como
--          'Liberado' = em_revisao). Recusa se houver NFS-e autorizada ou
--          boleto vivo ligado a esses itens.
--   D12-a  Relatório de timesheet e nota de débito passam a ser REGISTRADOS
--          quando gerados (quem, quando, arquivo) — hoje abrem no navegador
--          e não deixam rastro.
--   D13-a  Cartão por CLIENTE, com um bloco por CASO.
--   D14-b  Grupo de impostos e pagadores editáveis no kit enquanto a NFS-e
--          não foi emitida (reusa aplicar_ajustes_no_cadastro).
--   D15-a  "Este caso manda relatório de timesheet ao cliente" é configuração
--          do caso (contracts.casos.enviar_relatorio_timesheet).
--
-- Até aqui o kit era montado no front, por CONTRATO, a partir de
-- get_revisao_fatura + get_notas_geradas. Esta migração leva a montagem para
-- o banco (get_composicao_fatura), por (caso, competência), reaproveitando as
-- mesmas junções que as outras telas usam para boleto, NFS-e e conta a
-- receber — para que status e valores batam entre Composição, Notas geradas
-- e Fluxo.
--
-- Objetos:
--   1. coluna contracts.casos.enviar_relatorio_timesheet
--   2. CHECK de billing_notes.tipo_documento ganha 'relatorio_timesheet' e
--      'nota_debito'
--   3. bucket privado faturamento-documentos + policies
--   4. finance._kit_pode_operar(p_user_id)  — permissão de quem monta o kit
--   5. public.registrar_documento_kit(...)
--   6. public.excluir_kit(...)
--   7. public.get_composicao_fatura(...)
--   8. public.get_dados_envio_fatura(p_user_id, p_contrato_id, p_caso_id,
--      p_competencia) — sobrecarga nova, a antiga de 2 parâmetros fica.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. D15-a: o caso diz se o relatório de timesheet vai no e-mail da fatura.
-- ---------------------------------------------------------------------
ALTER TABLE contracts.casos
  ADD COLUMN IF NOT EXISTS enviar_relatorio_timesheet boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contracts.casos.enviar_relatorio_timesheet IS
  'D15-a (21/09): quando true, o e-mail da fatura anexa o relatório de timesheet do kit.';

-- ---------------------------------------------------------------------
-- 2. D12-a: relatório de timesheet e nota de débito viram documentos
--    registrados em billing_notes. O CHECK antigo só aceitava três tipos.
-- ---------------------------------------------------------------------
ALTER TABLE finance.billing_notes DROP CONSTRAINT IF EXISTS billing_notes_tipo_documento_check;
ALTER TABLE finance.billing_notes ADD CONSTRAINT billing_notes_tipo_documento_check
  CHECK (tipo_documento::text = ANY (ARRAY[
    'boleto_itau', 'relatorio_honorarios', 'nota_fiscal_servico',
    'relatorio_timesheet', 'nota_debito'
  ]));

-- ---------------------------------------------------------------------
-- 3. Bucket privado para os PDFs do kit (relatório de timesheet, nota de
--    débito). Caminho: <tenant>/<YYYY-MM>/<caso ou contrato>/<tipo>-<ts>.pdf.
--    billing_notes.arquivo_url guarda o PATH; quem lê assina na hora.
--    Mesmo padrão de colaboradores-fotos (20260723140000): bucket privado e
--    policy para o papel authenticated — aqui restrita a quem monta o kit.
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('faturamento-documentos', 'faturamento-documentos', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'auth_read_faturamento_documentos'
  ) THEN
    CREATE POLICY "auth_read_faturamento_documentos"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'faturamento-documentos'
        AND EXISTS (
          SELECT 1 FROM public.get_user_permissions(auth.uid()) p
          WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.nfse.manage',
                                     'finance.faturamento.*', 'finance.*', '*')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'auth_insert_faturamento_documentos'
  ) THEN
    CREATE POLICY "auth_insert_faturamento_documentos"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'faturamento-documentos'
        AND EXISTS (
          SELECT 1 FROM public.get_user_permissions(auth.uid()) p
          WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.nfse.manage',
                                     'finance.faturamento.*', 'finance.*', '*')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'auth_update_faturamento_documentos'
  ) THEN
    CREATE POLICY "auth_update_faturamento_documentos"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'faturamento-documentos'
        AND EXISTS (
          SELECT 1 FROM public.get_user_permissions(auth.uid()) p
          WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.nfse.manage',
                                     'finance.faturamento.*', 'finance.*', '*')
        )
      )
      WITH CHECK (bucket_id = 'faturamento-documentos');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Quem pode montar/desmontar o kit: finance.faturamento.manage (ou
--    curinga) OU a capacidade sensível finance.nfse.manage — que não é uma
--    permissão de core.permissions, é grant nominal/sócio via
--    tem_capacidade_sensivel (por isso as duas checagens).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance._kit_pode_operar(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.faturamento.*',
                               'finance.*', '*')
  ) OR public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage');
$$;

REVOKE ALL ON FUNCTION finance._kit_pode_operar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance._kit_pode_operar(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. D12-a: registrar relatório de timesheet / nota de débito do kit.
--    Regerar substitui: o documento anterior do mesmo tipo/caso/competência
--    ainda 'gerado' vira 'cancelado' antes de inserir o novo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_documento_kit(
  p_user_id uuid,
  p_caso_id uuid,
  p_contrato_id uuid,
  p_competencia date,
  p_tipo text,
  p_item_ids uuid[],
  p_arquivo_nome text,
  p_arquivo_url text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'people', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_nome text;
  v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para registrar documentos do kit';
  END IF;

  IF p_tipo IS NULL OR p_tipo NOT IN ('relatorio_timesheet', 'nota_debito') THEN
    RAISE EXCEPTION 'Tipo de documento inválido: %', p_tipo;
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos ct WHERE ct.id = p_contrato_id AND ct.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  IF p_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant AND cs.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado no contrato';
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  -- Regerar substitui o anterior (mesmo tipo, mesmo kit).
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = p_tipo
     AND bn.status = 'gerado'
     AND bn.contrato_id = p_contrato_id
     AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
     AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia;

  INSERT INTO finance.billing_notes (
    tenant_id, contrato_id, caso_id, tipo_documento, status,
    arquivo_nome, arquivo_url, metadata, created_by
  ) VALUES (
    v_tenant, p_contrato_id, p_caso_id, p_tipo, 'gerado',
    p_arquivo_nome, p_arquivo_url,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'item_ids', COALESCE(to_jsonb(p_item_ids), '[]'::jsonb),
      'competencia', v_competencia,
      'gerado_por_nome', COALESCE(v_nome, 'Usuário')
    ),
    p_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END $$;

REVOKE ALL ON FUNCTION public.registrar_documento_kit(uuid, uuid, uuid, date, text, uuid[], text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_documento_kit(uuid, uuid, uuid, date, text, uuid[], text, text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. D11-a / D10-a: excluir o kit = devolver os itens para a revisão.
--    Recusa com motivo se há NFS-e autorizada/processando ou boleto vivo
--    ligado aos itens. Nunca cancela NFS-e autorizada (ato fiscal, tela de
--    Notas geradas); só as que ficaram em erro. Timesheets voltam para
--    'revisao', como em bol_devolver_itens_da_nota (20260904130000).
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

  RETURN jsonb_build_object(
    'ok', true,
    'itens_devolvidos', v_itens,
    'horas_devolvidas', v_ts,
    'documentos_cancelados', v_docs,
    'nfse_erro_canceladas', v_nf_erro,
    'motivo', NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.excluir_kit(uuid, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_kit(uuid, uuid, uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. A Composição inteira num JSON: kits = itens aprovado/faturado
--    agrupados por (caso, competência); cliente > casos. Item sem caso cai
--    num bloco "Sem caso" por contrato.
--
--    Junções reaproveitadas:
--      NFS-e do kit         — nota cujo metadata.item_ids cruza os itens do
--                             kit (a 'gerado' primeiro, depois a mais recente)
--      conta a receber      — origem='faturamento' + origem_ref_id = nota,
--                             cancelada por último (get_notas_geradas)
--      boleto               — da conta a receber, vivo primeiro
--                             (get_notas_geradas / _boleto_resumo)
--      grupo de impostos    — contratos.grupo_imposto_id (o que a emissão usa)
--      pagadores            — casos.pagadores_servico [{cliente_id, percentual}],
--                             ou 100% o cliente do contrato
--                             (get_billing_items_aprovados_full)
--    'opcoes' vem do conjunto SEM filtro (para os selects não esvaziarem);
--    'resumo' e 'clientes', do conjunto filtrado.
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
           CASE WHEN gi.id IS NULL THEN NULL
                ELSE jsonb_build_object('id', gi.id, 'nome', gi.nome) END AS grupo_imposto,
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
           ), '[]'::jsonb) AS pagadores,
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
           END AS motivo_bloqueio
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
             'valor_servico', f.valor_servico,
             'valor_despesa', f.valor_despesa,
             'horas', f.horas,
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
          FROM (VALUES ('pendente'), ('nf_emitida'), ('enviado'), ('recebido')) s(status)
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

-- ---------------------------------------------------------------------
-- 8. Dados do e-mail da fatura POR KIT: a sobrecarga antiga (2 parâmetros)
--    fica intacta e continua sendo chamada pela edge enviar-fatura. A nova
--    devolve o mesmo JSON, com 'nota' = NFS-e do kit (caso + competência)
--    e 'anexos' = [{tipo, nome, url}]: NFS-e (URL do Focus), boleto (PDF
--    registrado como boleto_itau), relatório de timesheet (SÓ se o caso
--    tem enviar_relatorio_timesheet) e nota de débito — todos 'gerado'.
--    Anexo com bucket = path no storage (assinar antes de anexar); sem
--    bucket = URL pública/Focus.
--
--    p_caso_id e p_competencia NÃO têm DEFAULT de propósito: com DEFAULT, a
--    chamada de 2 argumentos casaria com as duas sobrecargas e o Postgres
--    recusaria como "function is not unique" (a armadilha de
--    get_notas_geradas, 20260921130000). Sem DEFAULT, 2 argumentos vão para
--    a antiga e 4 para a nova. Quem quer o comportamento por contrato passa
--    NULL nos dois.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dados_envio_fatura(
  p_user_id uuid,
  p_contrato_id uuid,
  p_caso_id uuid,
  p_competencia date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_out jsonb;
  v_nota jsonb;
  v_nota_id uuid;
  v_item_ids uuid[];
  v_envia_ts boolean := false;
  v_anexos jsonb := '[]'::jsonb;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  -- Base (cliente, destinatários, reply_to, permissão) vem da antiga.
  v_out := public.get_dados_envio_fatura(p_user_id, p_contrato_id);

  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;

  -- Itens do kit (para achar a NFS-e certa quando o caso tem mais de uma
  -- competência em aberto).
  IF p_caso_id IS NOT NULL OR v_competencia IS NOT NULL THEN
    SELECT array_agg(bi.id) INTO v_item_ids
      FROM finance.billing_items bi
     WHERE bi.tenant_id = v_tenant
       AND bi.contrato_id = p_contrato_id
       AND bi.status IN ('aprovado', 'faturado')
       AND (p_caso_id IS NULL OR bi.caso_id = p_caso_id)
       AND (v_competencia IS NULL
            OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia);

    SELECT jsonb_build_object('id', bn.id, 'numero', bn.numero,
                              'arquivo_nome', bn.arquivo_nome, 'arquivo_url', bn.arquivo_url),
           bn.id
      INTO v_nota, v_nota_id
      FROM finance.billing_notes bn
     WHERE bn.tenant_id = v_tenant
       AND bn.contrato_id = p_contrato_id
       AND bn.tipo_documento = 'nota_fiscal_servico'
       AND bn.status <> 'cancelado'
       AND (p_caso_id IS NULL OR bn.caso_id = p_caso_id)
       AND (
         v_item_ids IS NULL
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
           WHERE x.value::uuid = ANY (v_item_ids))
       )
     ORDER BY bn.created_at DESC
     LIMIT 1;

    v_out := v_out || jsonb_build_object('nota', v_nota);
  ELSE
    v_nota_id := NULLIF(v_out->'nota'->>'id', '')::uuid;
  END IF;

  SELECT COALESCE(cs.enviar_relatorio_timesheet, false) INTO v_envia_ts
    FROM contracts.casos cs WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant;

  -- 1) NFS-e (PDF do Focus).
  IF v_nota_id IS NOT NULL THEN
    SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
             'tipo', 'nfse', 'nome', COALESCE(bn.arquivo_nome, 'nfse.pdf'), 'url', bn.arquivo_url)), v_anexos)
      INTO v_anexos
      FROM finance.billing_notes bn
     WHERE bn.id = v_nota_id AND NULLIF(bn.arquivo_url, '') IS NOT NULL;

    -- 2) Boleto: PDF registrado como boleto_itau ligado à nota (ou ao kit).
    SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
             'tipo', 'boleto', 'nome', COALESCE(b.arquivo_nome, 'boleto.pdf'), 'url', b.arquivo_url,
             'bucket', CASE WHEN b.arquivo_url ~* '^https?://' THEN NULL ELSE 'faturamento-documentos' END)), v_anexos)
      INTO v_anexos
      FROM (
        SELECT bn.arquivo_nome, bn.arquivo_url
          FROM finance.billing_notes bn
         WHERE bn.tenant_id = v_tenant
           AND bn.tipo_documento = 'boleto_itau'
           AND bn.status = 'gerado'
           AND NULLIF(bn.arquivo_url, '') IS NOT NULL
           AND (
             NULLIF(bn.metadata->>'nota_id', '')::uuid = v_nota_id
             OR NULLIF(bn.metadata->>'billing_note_id', '')::uuid = v_nota_id
             OR (bn.contrato_id = p_contrato_id
                 AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
                 AND (v_competencia IS NULL
                      OR NULLIF(bn.metadata->>'competencia', '')::date = v_competencia))
           )
         ORDER BY bn.created_at DESC
         LIMIT 1
      ) b;
  END IF;

  -- 3) Relatório de timesheet (só se o caso pede) e 4) nota de débito.
  SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
           'tipo', d.tipo_documento, 'nome', COALESCE(d.arquivo_nome, d.tipo_documento || '.pdf'),
           'url', d.arquivo_url,
           'bucket', CASE WHEN d.arquivo_url ~* '^https?://' THEN NULL ELSE 'faturamento-documentos' END)
           ORDER BY d.tipo_documento DESC), v_anexos)
    INTO v_anexos
    FROM (
      SELECT DISTINCT ON (bn.tipo_documento) bn.tipo_documento, bn.arquivo_nome, bn.arquivo_url
        FROM finance.billing_notes bn
       WHERE bn.tenant_id = v_tenant
         AND bn.contrato_id = p_contrato_id
         AND bn.status = 'gerado'
         AND NULLIF(bn.arquivo_url, '') IS NOT NULL
         AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
         AND (v_competencia IS NULL OR NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
         AND (
           bn.tipo_documento = 'nota_debito'
           OR (bn.tipo_documento = 'relatorio_timesheet' AND v_envia_ts)
         )
       ORDER BY bn.tipo_documento, bn.created_at DESC
    ) d;

  RETURN v_out || jsonb_build_object(
    'caso_id', p_caso_id,
    'competencia', v_competencia,
    'enviar_relatorio_timesheet', v_envia_ts,
    'anexos', v_anexos
  );
END $$;

REVOKE ALL ON FUNCTION public.get_dados_envio_fatura(uuid, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dados_envio_fatura(uuid, uuid, uuid, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
