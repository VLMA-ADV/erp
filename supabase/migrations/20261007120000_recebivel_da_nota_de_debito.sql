-- =====================================================================
-- Boleto para kit só de despesas + nota única por contrato (SQL)
--
-- Pedido A (Filipe, 07/10/2026 — Elizir, caso 360, R$ 97,10): kit sem
-- serviço não tem NFS-e, logo não tem conta a receber, logo o botão de
-- boleto fica travado em "Emita a nota fiscal primeiro". 34 kits de outubro
-- (R$ 9.745,99) estão nessa situação. A nota de débito passa a gerar a sua
-- própria conta a receber (só quando o kit NÃO tem serviço — se tem, as
-- despesas continuam indo no boleto da NFS-e, como hoje) e o boleto nasce
-- dela.
--
-- Pedido B (Filipe, 07/10/2026 — Charles Sturmer, casos 1873 e 1877): uma
-- NFS-e só para vários casos do mesmo contrato. O motor (emit-nfse sem
-- caso_id) já emite por contrato e a Composição já casa a nota pelos
-- item_ids; aqui a Composição ganha os campos para o front saber que a nota
-- é conjunta, e a conta a receber da nota de contrato respeita a competência.
--
-- Achado no caminho (corrigido aqui): public.cp_sync_faturamento (botão da
-- tela de Contas a pagar) varre TODA billing_note 'gerado' sem focus_ref e
-- chama finance.criar_recebivel_da_nota — inclusive para notas de débito.
-- Resultado: 7 contas a receber penduradas em notas de débito, 4 delas com
-- o valor DOBRADO (valor_total da ND + as mesmas despesas de novo; ex.: ND
-- #191 da Elizir virou R$ 194,20 em vez de R$ 97,10) e 3 em kits COM
-- serviço. criar_recebivel_da_nota agora delega nota de débito para a
-- função nova, que tem as regras certas. Os 7 lançamentos existentes não
-- são tocados por esta migração (acerto manual, ver relato da rodada).
--
-- Objetos:
--   1. finance.criar_recebivel_da_nota_debito(p_nota_debito_id, p_user_id) — nova
--   2. finance.criar_recebivel_da_nota(...)  — delega ND; nota de contrato
--      soma só as despesas da competência dos itens da nota (B1)
--   3. public.registrar_documento_kit(...)   — mesma assinatura; cria o
--      recebível da ND e devolve lancamento_id/aviso
--   4. public.excluir_kit(...)               — bloqueia com boleto da ND e
--      cancela o recebível da ND ao devolver
--   5. public.get_composicao_fatura(...)     — conta_receber/boleto pela ND
--      quando não há NFS-e; boleto_base, nota_debito.lancamento_id,
--      irmaos_no_contrato, nota_compartilhada
-- Sem mudança: public.bol_lancamento_da_nota já acha o lançamento por
-- origem_ref_id = nota, e a nota de débito entra ali igual à NFS-e.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Conta a receber da nota de débito (kit só de despesas).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota_debito(p_nota_debito_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $$
DECLARE
  v_id uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_competencia date;
  v_item_ids uuid[] := '{}';
  v_ids uuid[] := '{}';
  v_despesas numeric := 0;
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_debito_id;
  IF NOT FOUND OR v_nota.tipo_documento <> 'nota_debito' OR v_nota.status <> 'gerado' THEN
    RETURN NULL;
  END IF;

  v_competencia := date_trunc('month', NULLIF(v_nota.metadata->>'competencia', '')::date)::date;
  IF v_competencia IS NULL THEN RETURN NULL; END IF;

  -- Idempotente: já tem conta a receber viva nesta nota de débito.
  IF EXISTS (
    SELECT 1 FROM finance.lancamentos l
     WHERE l.tenant_id = v_nota.tenant_id AND l.origem = 'faturamento'
       AND l.origem_ref_id = v_nota.id AND l.status <> 'cancelado'
  ) THEN
    RETURN NULL;
  END IF;

  -- Kit COM serviço: as despesas vão no boleto da NFS-e (criar_recebivel_da_nota),
  -- como hoje. "Serviço" é item que não é despesa e VALE alguma coisa — o caso
  -- 360 tem oito lançamentos de timesheet a R$ 0 (horas sem cobrança) e é
  -- justamente o kit que motivou o pedido; só o origem_tipo não basta.
  IF EXISTS (
    SELECT 1 FROM finance.billing_items bi
     WHERE bi.tenant_id = v_nota.tenant_id
       AND bi.contrato_id = v_nota.contrato_id
       AND bi.caso_id IS NOT DISTINCT FROM v_nota.caso_id
       AND bi.status IN ('aprovado', 'faturado')
       AND bi.origem_tipo <> 'despesa'
       AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
       AND COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) > 0
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(x.value::uuid), '{}') INTO v_item_ids
    FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x;

  -- Despesas aprovadas da nota de débito. 'faturado' fica de fora de propósito:
  -- é a marca de "já está numa conta a receber" (NFS-e ou ND anterior).
  SELECT COALESCE(array_agg(bi.id), '{}'),
         COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)), 0)
    INTO v_ids, v_despesas
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_nota.tenant_id
     AND bi.id = ANY (v_item_ids)
     AND bi.origem_tipo = 'despesa'
     AND bi.status = 'aprovado';

  IF v_despesas <= 0 THEN RETURN NULL; END IF;

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', ct.cliente_id,
    'Despesas — ' || COALESCE(cli.nome, 'cliente') || COALESCE(' (ND #' || v_nota.numero || ')', ''),
    round(v_despesas, 2),
    -- Mesma regra de vencimento da NFS-e (dia de pagamento do caso/contrato,
    -- ou +7 dias); vencimento_override no metadata também vale.
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY (v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', round(v_despesas, 2), 'lancamento_id', v_id))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION finance.criar_recebivel_da_nota_debito(uuid, uuid) IS
  'Conta a receber da nota de débito de um kit SEM serviço (Filipe, 07/10/2026). Kit com serviço devolve NULL: as despesas vão no boleto da NFS-e.';

-- ---------------------------------------------------------------------
-- 2. criar_recebivel_da_nota: nota de débito vai pela função acima; nota de
--    contrato (caso_id null) soma só as despesas da competência dos itens.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota(p_nota_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $$
DECLARE
  v_id uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_despesas numeric := 0;
  v_ids uuid[] := '{}';
  v_meses date[] := '{}';
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Nota de débito tem regra própria (kit só de despesas). Antes caía na
  -- regra da NFS-e via cp_sync_faturamento e dobrava o valor.
  IF v_nota.tipo_documento = 'nota_debito' THEN
    RETURN finance.criar_recebivel_da_nota_debito(p_nota_id, p_user_id);
  END IF;

  -- Elegivel? (mesmas condicoes de antes)
  IF v_nota.status <> 'gerado'
     OR NOT (v_nota.focus_ref IS NULL OR v_nota.focus_status = 'autorizado')
     OR COALESCE(NULLIF(v_nota.metadata->>'valor_total','')::numeric, 0) <= 0
     OR EXISTS (SELECT 1 FROM finance.lancamentos l
                 WHERE l.tenant_id = v_nota.tenant_id AND l.origem = 'faturamento'
                   AND l.origem_ref_id = v_nota.id AND l.status <> 'cancelado')
  THEN
    RETURN NULL;
  END IF;

  -- Competência(s) dos itens da nota. A nota de contrato (caso_id null) cobre
  -- um mês (emit-nfse filtra por competência) e as despesas que entram no
  -- boleto dela são as desse mês — não todas as aprovadas do contrato.
  -- focus_request.data_competencia não serve: é a data de emissão.
  SELECT COALESCE(array_agg(DISTINCT date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date), '{}')
    INTO v_meses
    FROM finance.billing_items bi
   WHERE bi.id IN (SELECT x.value::uuid
                     FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x);

  -- Despesas aprovadas do escopo da nota.
  SELECT COALESCE(array_agg(bi.id), '{}'), COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, 0)), 0)
    INTO v_ids, v_despesas
  FROM finance.billing_items bi
  WHERE bi.tenant_id = v_nota.tenant_id
    AND bi.origem_tipo = 'despesa'
    AND bi.status = 'aprovado'
    AND (
      (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
      OR (v_nota.caso_id IS NULL AND bi.contrato_id = v_nota.contrato_id
          AND (cardinality(v_meses) = 0
               OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = ANY (v_meses)))
    );

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', ct.cliente_id,
    CASE WHEN v_despesas > 0 THEN 'Honorários e despesas — ' ELSE 'Honorários — ' END
      || COALESCE(cli.nome, 'cliente')
      || COALESCE(' (NF #' || v_nota.numero || ')', ''),
    -- Liquido da nota (bruto - retencoes), nao o bruto (Filipe, 01/10).
    finance.valor_liquido_da_nota(v_nota.metadata) + v_despesas,
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY(v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', v_despesas, 'lancamento_id', v_id))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 3. registrar_documento_kit: nota de débito cria o recebível; regerar
--    substitui o recebível anterior (a menos que já tenha boleto vivo ou
--    baixa — aí nada é cancelado e o JSON traz 'aviso').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_documento_kit(p_user_id uuid, p_caso_id uuid, p_contrato_id uuid, p_competencia date, p_tipo text, p_item_ids uuid[], p_arquivo_nome text, p_arquivo_url text, p_metadata jsonb DEFAULT '{}'::jsonb)
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
  v_lanc_id uuid;
  v_aviso text;
  v_recebiveis_cancelados int := 0;
  v_travado boolean := false;
  r record;
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

  -- Regerar a nota de débito: a conta a receber da ND anterior sai de cena e
  -- a nova assume — exceto se o título já está no banco (boleto vivo) ou já
  -- foi recebido: aí não se mexe em nada e o front avisa (07/10).
  IF p_tipo = 'nota_debito' THEN
    FOR r IN
      SELECT l.id AS lanc_id, bn.id AS nota_id, bn.metadata->'despesas_no_boleto'->'item_ids' AS item_ids,
             (l.status IN ('pago', 'recebido') OR l.baixa_data IS NOT NULL) AS baixado,
             EXISTS (SELECT 1 FROM finance.boletos b
                      WHERE b.lancamento_id = l.id
                        AND b.status NOT IN ('cancelado', 'erro', 'baixado')) AS boleto_vivo
        FROM finance.billing_notes bn
        JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                  AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
                                  AND l.status <> 'cancelado'
       WHERE bn.tenant_id = v_tenant
         AND bn.tipo_documento = 'nota_debito'
         AND bn.status = 'gerado'
         AND bn.contrato_id = p_contrato_id
         AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
         AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
    LOOP
      IF r.boleto_vivo OR r.baixado THEN
        v_travado := true;
        v_aviso := CASE WHEN r.boleto_vivo
                        THEN 'A nota de débito anterior já tem boleto registrado no banco: a conta a receber foi mantida e o novo PDF não gerou outra.'
                        ELSE 'A conta a receber da nota de débito anterior já foi baixada: foi mantida e o novo PDF não gerou outra.' END;
      END IF;
    END LOOP;

    IF NOT v_travado THEN
      FOR r IN
        SELECT l.id AS lanc_id, bn.metadata->'despesas_no_boleto'->'item_ids' AS item_ids
          FROM finance.billing_notes bn
          JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                    AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
                                    AND l.status <> 'cancelado'
         WHERE bn.tenant_id = v_tenant
           AND bn.tipo_documento = 'nota_debito'
           AND bn.status = 'gerado'
           AND bn.contrato_id = p_contrato_id
           AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
           AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
      LOOP
        UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now() WHERE id = r.lanc_id;
        v_recebiveis_cancelados := v_recebiveis_cancelados + 1;
        -- As despesas que esse recebível tinha marcado como faturadas voltam a
        -- 'aprovado' para o recebível novo somá-las de novo.
        UPDATE finance.billing_items bi
           SET status = 'aprovado', updated_at = now()
         WHERE bi.tenant_id = v_tenant
           AND bi.status = 'faturado'
           AND bi.origem_tipo = 'despesa'
           AND bi.id IN (SELECT x.value::uuid
                           FROM jsonb_array_elements_text(COALESCE(r.item_ids, '[]'::jsonb)) x);
      END LOOP;
    END IF;
  END IF;

  -- Regerar substitui o anterior (mesmo tipo, mesmo kit). Com recebível travado
  -- (boleto vivo/baixa) a ND anterior fica como está: é ela que sustenta o título.
  IF NOT v_travado THEN
    UPDATE finance.billing_notes bn
       SET status = 'cancelado'
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = p_tipo
       AND bn.status = 'gerado'
       AND bn.contrato_id = p_contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia;
  END IF;

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

  -- Kit só de despesas ganha conta a receber pela ND (kit com serviço: NULL,
  -- as despesas vão no boleto da NFS-e).
  IF p_tipo = 'nota_debito' AND NOT v_travado THEN
    v_lanc_id := finance.criar_recebivel_da_nota_debito(v_id, p_user_id);
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'lancamento_id', v_lanc_id,
    'recebiveis_cancelados', v_recebiveis_cancelados,
    'aviso', v_aviso
  );
END $$;

-- ---------------------------------------------------------------------
-- 4. excluir_kit: boleto vivo da nota de débito também trava; ao devolver,
--    o recebível da ND (sem boleto vivo) é cancelado junto com os documentos.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_kit(p_user_id uuid, p_caso_id uuid, p_contrato_id uuid, p_competencia date)
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
  v_recebiveis int := 0;
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
  -- Casa por item_ids, não por caso: vale igual para nota de contrato
  -- (caso_id null) que cobre vários casos.
  SELECT bn.id, bn.numero, bn.focus_status, bn.caso_id,
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
      'motivo', CASE WHEN v_nota.caso_id IS NULL
                     THEN 'NFS-e ' || v_nota.nfse_numero || ' conjunta com outros casos'
                     WHEN v_nota.focus_status = 'autorizado'
                     THEN 'NFS-e ' || v_nota.nfse_numero || ' autorizada'
                     ELSE 'NFS-e ' || v_nota.nfse_numero || ' em processamento' END);
  END IF;

  -- Bloqueio 2: boleto vivo (registrado/emitido/pago/liquidado) numa conta a
  -- receber de qualquer NFS-e desses itens — inclusive de nota já cancelada,
  -- porque o boleto continua no banco. Idem para a nota de débito do kit
  -- (boleto do kit só de despesas, 07/10).
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE bn.tenant_id = v_tenant
       AND b.status NOT IN ('cancelado', 'erro', 'baixado')
       AND (
         (bn.tipo_documento = 'nota_fiscal_servico' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
           WHERE x.value::uuid = ANY (v_item_ids)))
         OR
         (bn.tipo_documento = 'nota_debito'
          AND bn.contrato_id = p_contrato_id
          AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
          AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
       )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0, 'motivo', 'Boleto registrado');
  END IF;

  -- Bloqueio 3: conta a receber da nota de débito já recebida (sem boleto, baixa
  -- manual): devolver os itens apagaria a origem de um dinheiro que entrou.
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_debito'
       AND bn.contrato_id = p_contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
       AND (l.status IN ('pago', 'recebido') OR l.baixa_data IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0, 'motivo', 'Conta a receber da nota de débito já baixada');
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
           || to_char(v_competencia, 'MM/YYYY') || '): item devolvido para aprovação (revisão preservada)',
         v_tenant, now()
    FROM finance.billing_items bi
   WHERE bi.id = ANY (v_item_ids);

  -- Volta para a etapa de aprovação (em_aprovacao), NÃO para o início: a
  -- revisão (valor_revisado, horas_revisadas, responsavel_revisao_id,
  -- data_revisao) fica como estava e só a aprovação é limpa. Filipe, 28/09:
  -- "reinicia toda a jornada a partir da aprovação e nunca do lançamento
  -- original, senão perdemos as infos de revisão e aprovação".
  UPDATE finance.billing_items bi
     SET status = 'em_aprovacao',
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

  -- Conta a receber da nota de débito do kit (sem boleto vivo — já checado
  -- acima) sai junto: a despesa voltou para aprovação, não há o que cobrar.
  UPDATE finance.lancamentos l
     SET status = 'cancelado', updated_at = now()
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento'
     AND l.status NOT IN ('cancelado', 'pago', 'recebido')
     AND l.origem_ref_id IN (
       SELECT bn.id FROM finance.billing_notes bn
        WHERE bn.tenant_id = v_tenant
          AND bn.tipo_documento = 'nota_debito'
          AND bn.contrato_id = p_contrato_id
          AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
          AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     );
  GET DIAGNOSTICS v_recebiveis = ROW_COUNT;

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
    'recebiveis_cancelados', v_recebiveis,
    'nfse_erro_canceladas', v_nf_erro,
    'kit_apagado', v_kit > 0,
    'motivo', NULL
  );
END $$;

-- ---------------------------------------------------------------------
-- 5. get_composicao_fatura: conta a receber e boleto pela nota de débito
--    quando o kit não tem serviço; campos novos boleto_base,
--    nota_debito.lancamento_id, irmaos_no_contrato e nota_compartilhada.
--    Última versão antes desta: 20260928130000_composicao_foto_profissional.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_composicao_fatura(p_user_id uuid, p_competencia date DEFAULT NULL::date, p_cliente_id uuid DEFAULT NULL::uuid, p_contrato_id uuid DEFAULT NULL::uuid, p_caso_id uuid DEFAULT NULL::uuid, p_regra text DEFAULT NULL::text, p_status_kit text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    SELECT bi.id, bi.contrato_id, bi.caso_id, bi.origem_tipo, bi.origem_id, bi.status,
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
  -- B1: quantos CASOS cada NFS-e cobre. Mais de um = nota conjunta (nota única
  -- por contrato, Filipe 07/10: Charles Sturmer, casos 1873 e 1877). Conta
  -- casos, não kits: a mesma nota com itens de dois meses do MESMO caso (A&S
  -- Fersa 2103, Bravia 2104) não é conjunta.
  nota_kits AS (
    SELECT ni.nota_id,
           count(DISTINCT COALESCE(ic.caso_id::text, 'contrato:' || ic.contrato_id::text)) AS n_kits
      FROM nota_itens ni
      JOIN itens_chave ic ON ic.id = ni.item_id
     GROUP BY ni.nota_id
  ),
  -- A NFS-e "do kit": a viva (gerado) primeiro, depois a mais recente.
  kit_nfse AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, bn.id, bn.numero, bn.status, bn.focus_status, bn.caso_id,
           bn.arquivo_nome, bn.arquivo_url, bn.created_at,
           COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                    NULLIF(bn.metadata->>'nfse_numero', '')) AS nfse_numero,
           NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total,
           (bn.caso_id IS NULL OR COALESCE(nk.n_kits, 1) > 1) AS compartilhada
      FROM kit_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
      LEFT JOIN nota_kits nk ON nk.nota_id = bn.id
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
  -- Notas de débito do kit, de QUALQUER status: a conta a receber pode estar
  -- numa ND já substituída (regerada com boleto vivo) — mesma lógica da NFS-e.
  kit_nd_notas AS (
    SELECT k.chave, bn.id AS nota_id
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_debito'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
  ),
  kit_nd_lanc AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nd_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
     ORDER BY kn.chave, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_nd_boleto AS (
    SELECT DISTINCT ON (kl.chave)
           kl.chave, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_nd_lanc kl
      JOIN finance.boletos b ON b.lancamento_id = kl.id
     ORDER BY kl.chave, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  kit_nd_boleto_vivo AS (
    SELECT DISTINCT kn.chave
      FROM kit_nd_notas kn
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
           COALESCE(nf.compartilhada, false) AS nota_compartilhada,
           -- Base do boleto. Kit com serviço (ou que já tem conta da NFS-e):
           -- NFS-e, como sempre. Kit só de despesas: a conta a receber da nota
           -- de débito, quando existe e está viva (07/10). Senão, nada ainda.
           CASE
             WHEN l.id IS NOT NULL OR k.valor_servico > 0 THEN 'nfse'
             WHEN ndl.id IS NOT NULL AND ndl.status <> 'cancelado' THEN 'nota_debito'
             ELSE NULL
           END AS boleto_base,
           -- Conta a receber e boleto "do kit": da NFS-e, ou da ND no kit só de despesas.
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.id ELSE bo.id END AS boleto_id,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.status ELSE bo.status END AS boleto_status,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.vencimento ELSE bo.vencimento END AS boleto_vencimento,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.valor ELSE bo.valor END AS boleto_valor,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.linha_digitavel ELSE bo.linha_digitavel END AS linha_digitavel,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.nosso_numero ELSE bo.nosso_numero END AS nosso_numero,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.pix_copia_cola ELSE bo.pix_copia_cola END AS pix_copia_cola,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.id ELSE l.id END AS lanc_id,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END AS lanc_status,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.valor ELSE l.valor END AS lanc_valor,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.vencimento ELSE l.vencimento END AS lanc_vencimento,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END AS lanc_baixa_data,
           -- Lançamento da ND exposto só quando é ele que sustenta o boleto do kit.
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 AND ndl.status <> 'cancelado' THEN ndl.id END AS nd_lanc_id,
           env.enviado_em, env.destinatario, env.por AS envio_por, env.erro AS envio_erro,
           env.total AS envio_total, COALESCE(env.algum_ok, false) AS envio_ok,
           -- Boleto vivo em qualquer nota do kit (NFS-e ou ND) trava a devolução.
           (bv.chave IS NOT NULL OR ndbv.chave IS NOT NULL) AS boleto_vivo,
           -- B1: kits deste contrato+competência que ainda cabem numa nota única
           -- (têm serviço e não têm NFS-e viva). Conta o próprio kit; front usa >= 2.
           count(*) FILTER (
             WHERE k.valor_servico > 0
               AND NOT COALESCE(nf.status = 'gerado' AND COALESCE(nf.focus_status, '') NOT IN ('erro', 'erro_autorizacao'), false)
           ) OVER (PARTITION BY k.contrato_id, k.competencia) AS irmaos_no_contrato,
           CASE
             WHEN (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END) IN ('pago', 'recebido')
               OR (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END) IS NOT NULL
               THEN 'recebido'
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
      LEFT JOIN kit_nd_lanc ndl ON ndl.chave = k.chave
      LEFT JOIN kit_nd_boleto ndb ON ndb.chave = k.chave
      LEFT JOIN kit_envio env ON env.chave = k.chave
      LEFT JOIN kit_boleto_vivo bv ON bv.chave = k.chave
      LEFT JOIN kit_nd_boleto_vivo ndbv ON ndbv.chave = k.chave
      LEFT JOIN kit_estado ke ON ke.chave = k.chave
  ),
  filtrado AS (
    SELECT kf.*,
           CASE
             -- Nota única por contrato: devolver um caso desfaria a nota dos outros.
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status IN ('autorizado', 'processando')
                  AND kf.nota_compartilhada
               THEN 'NFS-e conjunta com outros casos'
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
                          'foto_url', (SELECT col.foto_url FROM operations.timesheets t JOIN people.colaboradores col ON col.user_id = t.created_by WHERE t.id = ic.origem_id LIMIT 1),
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
                    'foto_url', (SELECT col.foto_url FROM operations.timesheets t JOIN people.colaboradores col ON col.user_id = t.created_by WHERE t.id = ic.origem_id LIMIT 1),
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
                 'valor_total', f.nfse_valor_total, 'created_at', f.nfse_created_at,
                 'compartilhada', f.nota_compartilhada) END,
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
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url,
                                           'lancamento_id', f.nd_lanc_id)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'nota_debito')
             ),
             'boleto_base', f.boleto_base,
             'envio', CASE WHEN f.enviado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'enviado_em', f.enviado_em, 'destinatario', f.destinatario, 'por', f.envio_por,
               'erro', f.envio_erro, 'total', f.envio_total) END,
             'conta_receber', CASE WHEN f.lanc_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', f.lanc_id, 'status', f.lanc_status, 'valor', f.lanc_valor,
               'vencimento', f.lanc_vencimento, 'pago_em', f.lanc_baixa_data) END,
             'irmaos_no_contrato', f.irmaos_no_contrato,
             'nota_compartilhada', f.nota_compartilhada,
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
