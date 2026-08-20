-- =====================================================================
-- Enviar a fatura por e-mail direto do ERP
--
-- Filipe, 19/08: "mas eu digo, pra enviar a fatura direto pelo ERP, nos vamos
-- conseguir? tipo montar a fatura e o email e enviar o send".
--
-- A composição da fatura já montava o e-mail inteiro, com os dois templates do
-- escritório, e o botão "Aprovar e enviar" existia — só que apertava e caía num
-- "em breve". Aqui entra o que faltava do lado do banco.
--
-- REMETENTE: financeiro@erp.vlma.com.br, com reply-to no financeiro. Conferi na
-- conta do Resend: o único domínio verificado é erp.vlma.com.br. Configurar
-- financeiro@vlma.com.br hoje faria o Resend RECUSAR o envio — quando o
-- domínio principal for verificado, é trocar uma string.
-- =====================================================================

CREATE TABLE IF NOT EXISTS finance.fatura_envios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  contrato_id    uuid NOT NULL,
  billing_note_id uuid,
  destinatario   text NOT NULL,
  assunto        text NOT NULL,
  corpo          text NOT NULL,
  anexos         jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_id    text,
  erro           text,
  enviado_em     timestamptz NOT NULL DEFAULT now(),
  enviado_por    uuid
);

CREATE INDEX IF NOT EXISTS idx_fatura_envios_contrato
  ON finance.fatura_envios (tenant_id, contrato_id, enviado_em DESC);

ALTER TABLE finance.fatura_envios ENABLE ROW LEVEL SECURITY;

-- Dados do envio, resolvidos NO BANCO.
--
-- O destinatário sai daqui e não do pedido que chega do navegador. Aceitar o
-- e-mail que a tela mandasse transformaria o ERP num relay: qualquer pessoa
-- logada poderia disparar mensagem para um endereço qualquer usando o domínio
-- do escritório. O texto o usuário escolhe (é o que ele leu e aprovou na
-- prévia); para quem vai, quem decide é o cadastro.
CREATE OR REPLACE FUNCTION public.get_dados_envio_fatura(p_user_id uuid, p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_out jsonb;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage') THEN
    RAISE EXCEPTION 'Sem permissão para enviar fatura';
  END IF;

  SELECT jsonb_build_object(
    'contrato_id', ct.id,
    'cliente_nome', cl.nome,
    'destinatario', NULLIF(trim(cl.email), ''),
    'nota', (
      SELECT jsonb_build_object('id', bn.id, 'numero', bn.numero,
                                'arquivo_nome', bn.arquivo_nome, 'arquivo_url', bn.arquivo_url)
      FROM finance.billing_notes bn
      WHERE bn.tenant_id = v_tenant AND bn.contrato_id = ct.id
        AND bn.tipo_documento = 'nota_fiscal_servico' AND bn.status <> 'cancelado'
      ORDER BY bn.created_at DESC LIMIT 1
    ),
    'reply_to', public.get_emails_financeiro(v_tenant)
  ) INTO v_out
  FROM contracts.contratos ct
  JOIN crm.clientes cl ON cl.id = ct.cliente_id
  WHERE ct.id = p_contrato_id AND ct.tenant_id = v_tenant;

  IF v_out IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_envio_fatura(
  p_user_id uuid, p_contrato_id uuid, p_billing_note_id uuid,
  p_destinatario text, p_assunto text, p_corpo text,
  p_anexos jsonb DEFAULT '[]'::jsonb, p_provider_id text DEFAULT NULL, p_erro text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  INSERT INTO finance.fatura_envios (tenant_id, contrato_id, billing_note_id, destinatario,
                                     assunto, corpo, anexos, provider_id, erro, enviado_por)
  VALUES (v_tenant, p_contrato_id, p_billing_note_id, p_destinatario,
          p_assunto, p_corpo, COALESCE(p_anexos, '[]'::jsonb), p_provider_id, p_erro, p_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- Histórico de envios de um contrato, para a tela mostrar "já foi enviada".
CREATE OR REPLACE FUNCTION public.get_envios_fatura(p_user_id uuid, p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'destinatario', e.destinatario,
             'enviado_em', e.enviado_em, 'erro', e.erro) ORDER BY e.enviado_em DESC)
    FROM finance.fatura_envios e
    WHERE e.tenant_id = v_tenant AND e.contrato_id = p_contrato_id
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dados_envio_fatura(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_envio_fatura(uuid, uuid, uuid, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dados_envio_fatura(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_envio_fatura(uuid, uuid, uuid, text, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_envios_fatura(uuid, uuid) TO authenticated, service_role;
