-- Correcao: despesa de lote volta a respeitar a marcacao do usuario.
--
-- Eu tinha forcado reembolsavel = false dentro do lote, por ler o campo como
-- "o VLMA devolve o dinheiro para a pessoa". Nao e isso: reembolsavel quer
-- dizer REPASSAVEL AO CLIENTE — e a flag que faz a despesa chegar ao
-- faturamento (start_faturamento_despesas_fallback filtra por ela). Forcar
-- false tirava a despesa da cobranca do cliente sem ninguem pedir.
--
-- Filipe (11/08): "no geral as despesas usadas no lote sao a maioria
-- reembolsaveis". Entao a marcacao continua sendo do usuario, dentro ou fora do
-- lote, e o acerto do lote segue sendo outra conta — ele acerta o adiantamento
-- com a PESSOA, e o reembolsavel decide o que vai para o CLIENTE. Sao dois
-- eixos independentes.

CREATE OR REPLACE FUNCTION public.create_despesa(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_contrato_id uuid;
  v_caso_id uuid;
  v_cliente_id uuid;
  v_valor numeric(14,2);
  v_lote_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NULLIF(p_payload->>'contrato_id', '') IS NULL OR NULLIF(p_payload->>'caso_id', '') IS NULL THEN
    RAISE EXCEPTION 'Contrato e caso são obrigatórios';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'categoria'), ''), '') = '' THEN
    RAISE EXCEPTION 'Categoria é obrigatória';
  END IF;

  -- Comprovante deixou de ser obrigatório (pedido Filipe 03/08): a despesa
  -- pode ser lançada na hora e o comprovante anexado depois. Sem arquivo, a
  -- despesa nasce marcada como pendente de comprovante (ver status abaixo).

  v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'Valor da despesa é obrigatório e deve ser maior que zero';
  END IF;

  -- Lote: so aceita lote da propria pessoa e ainda aberto.
  v_lote_id := NULLIF(p_payload->>'lote_id', '')::uuid;
  PERFORM operations.validar_lote_da_despesa(v_lote_id, p_user_id, v_tenant_id);

  v_contrato_id := (p_payload->>'contrato_id')::uuid;
  v_caso_id := (p_payload->>'caso_id')::uuid;

  SELECT c.cliente_id INTO v_cliente_id
  FROM contracts.contratos c
  WHERE c.id = v_contrato_id AND c.tenant_id = v_tenant_id AND c.status = 'ativo';

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado ou encerrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = v_caso_id AND cs.contrato_id = v_contrato_id
      AND cs.tenant_id = v_tenant_id AND cs.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado/ativo para o contrato informado';
  END IF;

  INSERT INTO operations.despesas (
    tenant_id, cliente_id, contrato_id, caso_id, data_lancamento, categoria,
    valor, descricao, status, arquivo_nome, mime_type, tamanho_bytes, arquivo,
    reembolsavel, lote_id, created_by, updated_by
  ) VALUES (
    v_tenant_id, v_cliente_id, v_contrato_id, v_caso_id,
    COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, now()::date),
    trim(p_payload->>'categoria'),
    v_valor,
    COALESCE(p_payload->>'descricao', ''),
    'em_lancamento',
    NULLIF(trim(COALESCE(p_payload->>'arquivo_nome', '')), ''),
    NULLIF(p_payload->>'mime_type', ''),
    NULLIF(p_payload->>'tamanho_bytes', '')::bigint,
    CASE WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') = ''
         THEN NULL ELSE decode(p_payload->>'arquivo_base64', 'base64') END,
    COALESCE((p_payload->>'reembolsavel')::boolean, true),
    v_lote_id,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  -- Anexos adicionais (opcionais)
  IF jsonb_typeof(p_payload->'anexos_extra') = 'array' THEN
    INSERT INTO operations.despesa_anexos (tenant_id, despesa_id, arquivo, arquivo_nome, mime_type, tamanho_bytes)
    SELECT v_tenant_id, v_id,
      decode(e->>'arquivo_base64', 'base64'),
      trim(e->>'arquivo_nome'),
      NULLIF(e->>'mime_type', ''),
      NULLIF(e->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_payload->'anexos_extra') e
    WHERE COALESCE(NULLIF(trim(e->>'arquivo_base64'), ''), '') <> ''
      AND COALESCE(NULLIF(trim(e->>'arquivo_nome'), ''), '') <> '';
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$function$
;

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
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  IF v_current.status = 'aprovado' THEN
    RAISE EXCEPTION 'Despesa aprovada não pode ser alterada';
  END IF;

  v_is_admin := COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  IF v_current.status <> 'em_lancamento'
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
    arquivo_nome = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN COALESCE(NULLIF(trim(p_payload->>'arquivo_nome'), ''), d.arquivo_nome)
      ELSE d.arquivo_nome END,
    mime_type = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'mime_type', '')
      ELSE d.mime_type END,
    tamanho_bytes = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'tamanho_bytes', '')::bigint
      ELSE d.tamanho_bytes END,
    arquivo = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN decode(p_payload->>'arquivo_base64', 'base64')
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
$function$
;
