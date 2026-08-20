-- =====================================================================
-- Controle visual do que já foi enviado + remetente registrado
--
-- Filipe, 20/08: "O que podemos pensar é ter apenas um controle visual ali no
-- módulo da fatura para controlar o que foi enviado (talvez com uma
-- sinalização em verde) de que foi enviado".
--
-- A tabela finance.fatura_envios já guardava cada envio; faltava a tela poder
-- perguntar "quais contratos já foram enviados" de uma vez só, em vez de um
-- contrato por vez.
--
-- Guarda também DE QUAL ENDEREÇO saiu. Enquanto vlma.com.br não estiver
-- verificado no Resend, o envio cai para o subdomínio — e quando alguém
-- perguntar "mas não era para sair da Jessika?", a resposta tem de estar no
-- registro, não na memória de quem fez.
-- =====================================================================

ALTER TABLE finance.fatura_envios ADD COLUMN IF NOT EXISTS remetente text;

CREATE OR REPLACE FUNCTION public.registrar_envio_fatura(
  p_user_id uuid, p_contrato_id uuid, p_billing_note_id uuid,
  p_destinatario text, p_assunto text, p_corpo text,
  p_anexos jsonb DEFAULT '[]'::jsonb, p_provider_id text DEFAULT NULL,
  p_erro text DEFAULT NULL, p_remetente text DEFAULT NULL
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
                                     assunto, corpo, anexos, provider_id, erro, enviado_por, remetente)
  VALUES (v_tenant, p_contrato_id, p_billing_note_id, p_destinatario,
          p_assunto, p_corpo, COALESCE(p_anexos, '[]'::jsonb), p_provider_id, p_erro, p_user_id, p_remetente)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- Últimos envios por contrato. Com p_contrato_id nulo devolve TODOS os
-- contratos que já tiveram envio — é o que a composição precisa para pintar o
-- verde sem uma consulta por linha.
CREATE OR REPLACE FUNCTION public.get_envios_fatura(p_user_id uuid, p_contrato_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'people', 'core'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_object_agg(x.contrato_id, jsonb_build_object(
             'enviado_em', x.enviado_em,
             'destinatario', x.destinatario,
             'remetente', x.remetente,
             'por', x.por,
             'erro', x.erro,
             'total', x.total
           ))
    FROM (
      SELECT DISTINCT ON (e.contrato_id)
             e.contrato_id::text AS contrato_id,
             e.enviado_em, e.destinatario, e.remetente, e.erro,
             c.nome AS por,
             (SELECT count(*) FROM finance.fatura_envios t
               WHERE t.tenant_id = v_tenant AND t.contrato_id = e.contrato_id) AS total
      FROM finance.fatura_envios e
      LEFT JOIN people.colaboradores c ON c.user_id = e.enviado_por AND c.tenant_id = e.tenant_id
      WHERE e.tenant_id = v_tenant
        AND (p_contrato_id IS NULL OR e.contrato_id = p_contrato_id)
      ORDER BY e.contrato_id, e.enviado_em DESC
    ) x
  ), '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_envio_fatura(uuid, uuid, uuid, text, text, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_envio_fatura(uuid, uuid, uuid, text, text, text, jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_envios_fatura(uuid, uuid) TO authenticated, service_role;
