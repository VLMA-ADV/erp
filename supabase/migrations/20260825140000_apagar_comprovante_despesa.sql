-- Apagar o comprovante principal da despesa (pedido Filipe, 25/08).
--
-- Ate aqui o comprovante principal so podia ser SUBSTITUIDO, nunca removido — a
-- ideia era garantir que nenhuma despesa entrasse no reembolso sem nota. O
-- Filipe pediu para permitir a remocao ("questao de dia a dia... se faltar
-- comprovante, nos solicitaremos") e liberou explicitamente INCLUSIVE para
-- despesa ja aprovada.
--
-- Duas mudancas, so nesta funcao:
--   1. Ramo 'arquivo_remove': zera arquivo/nome/mime/tamanho. Substituir ganha
--      de remover (se vier base64 novo E arquivo_remove, o arquivo novo vale).
--   2. A trava "despesa aprovada nao altera" — que protege o valor ja aprovado
--      para reembolso — passa a ceder SO quando o payload mexe unicamente em
--      anexos (comprovante e adicionais). Valor, categoria, lote etc. de uma
--      despesa aprovada continuam intocaveis. O que ele pediu foi trocar/tirar
--      documento, nao reabrir o numero.
--
-- A coluna operations.despesas.arquivo ja e nullable desde 03/08
-- (20260803200000_despesa_sem_arquivo.sql), entao nada de DDL aqui — get_despesas
-- e a nota de despesa ja lidam com comprovante ausente.

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
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

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
