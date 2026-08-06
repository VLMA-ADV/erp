-- Corrige o conversor de lead: o "contato" do lead e o NOME de uma pessoa,
-- nao um numero de telefone. Gravar ele em clientes.telefone sujava o
-- cadastro (o cliente ficava com telefone = "Fulano de Teste"). O contato
-- continua guardado no proprio card, que sobrevive a conversao.
-- Telefone agora so vem quando informado explicitamente no payload.



CREATE OR REPLACE FUNCTION public.converter_lead_em_cliente(
  p_user_id uuid, p_card_id uuid, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_tenant_id uuid; v_card crm.pipeline_cards%ROWTYPE;
  v_nome text; v_email text; v_telefone text; v_segmento uuid;
  v_cnpj text; v_estrangeiro boolean; v_cliente_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO v_card FROM crm.pipeline_cards c
   WHERE c.id = p_card_id AND c.tenant_id = v_tenant_id AND c.ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;
  IF v_card.cliente_id IS NOT NULL THEN RAISE EXCEPTION 'Este card já está ligado a um cliente'; END IF;

  v_nome  := COALESCE(NULLIF(trim(p_payload->>'nome'), ''), v_card.lead_nome);
  v_email := COALESCE(NULLIF(trim(p_payload->>'email'), ''), v_card.lead_email);
  -- Telefone so vem do payload. O "contato" do lead e o NOME de uma pessoa,
  -- nao um numero — gravar ele aqui sujava o cadastro. Ele continua guardado
  -- no proprio card (lead_contato), que sobrevive a conversao.
  v_telefone := NULLIF(trim(p_payload->>'telefone'), '');
  v_segmento := COALESCE(NULLIF(p_payload->>'segmento_id', '')::uuid, v_card.lead_segmento_id);

  IF COALESCE(v_nome, '') = '' THEN RAISE EXCEPTION 'Nome do cliente é obrigatório'; END IF;

  v_cnpj := NULLIF(regexp_replace(COALESCE(p_payload->>'cnpj', ''), '[^0-9]', '', 'g'), '');
  v_estrangeiro := COALESCE((p_payload->>'cliente_estrangeiro')::boolean, false);
  IF v_cnpj IS NULL AND NOT v_estrangeiro THEN
    RAISE EXCEPTION 'Informe o CNPJ/CPF do cliente, ou marque como cliente estrangeiro';
  END IF;

  SELECT id INTO v_cliente_id FROM crm.clientes
   WHERE tenant_id = v_tenant_id AND lower(trim(nome)) = lower(trim(v_nome)) LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO crm.clientes (tenant_id, nome, email, telefone, cnpj, cliente_estrangeiro)
    VALUES (v_tenant_id, v_nome, v_email, v_telefone, v_cnpj, v_estrangeiro)
    RETURNING id INTO v_cliente_id;
  END IF;

  IF v_segmento IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.clientes_segmentos cs WHERE cs.cliente_id = v_cliente_id AND cs.segmento_id = v_segmento
  ) THEN
    INSERT INTO crm.clientes_segmentos (cliente_id, segmento_id) VALUES (v_cliente_id, v_segmento);
  END IF;

  UPDATE crm.pipeline_cards SET cliente_id = v_cliente_id, updated_at = now(), updated_by = p_user_id
   WHERE id = p_card_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('cliente_id', v_cliente_id, 'card_id', p_card_id);
END;
$function$;

