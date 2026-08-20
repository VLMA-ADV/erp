-- =====================================================================
-- Destinatários da fatura: ler os responsáveis financeiros do cliente
--
-- Filipe, 20/08: "apareceu essa mensagem, mesmo com os emails cadastrados".
--
-- Ele estava certo e eu estava lendo o lugar errado. O e-mail do financeiro do
-- cliente mora em crm.clientes_responsaveis_financeiros — pode haver VÁRIOS por
-- cliente. A 7 Holding, por exemplo, tem três (talita@, gabriela@ e
-- victor@versibr.com). A primeira versão desta função olhava só
-- crm.clientes.email, que é outro campo e quase sempre está vazio.
--
-- Isso também corrige um número que eu vinha reportando errado: não são 151
-- clientes sem e-mail. Considerando as duas fontes, 128 dos 216 faturáveis têm
-- endereço cadastrado.
--
-- Devolve LISTA, não um endereço: quando há três responsáveis, mandar só para o
-- primeiro seria escolher por conta própria quem do cliente recebe a cobrança.
-- =====================================================================
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
    'cliente_id', cl.id,
    'cliente_nome', cl.nome,
    -- Responsáveis financeiros primeiro (é o endereço certo para cobrança);
    -- o e-mail geral do cliente entra como reserva quando não há nenhum.
    'destinatarios', COALESCE((
      SELECT jsonb_agg(DISTINCT e) FROM (
        SELECT lower(trim(r.email)) AS e
        FROM crm.clientes_responsaveis_financeiros r
        WHERE r.cliente_id = cl.id AND NULLIF(trim(r.email), '') IS NOT NULL
        UNION
        SELECT lower(trim(cl.email))
        WHERE NULLIF(trim(cl.email), '') IS NOT NULL
      ) x
    ), '[]'::jsonb),
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
