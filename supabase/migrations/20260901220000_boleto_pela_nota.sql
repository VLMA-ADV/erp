-- =====================================================================
-- Achar o lancamento a receber a partir da nota fiscal
--
-- A tela de Composicao da Fatura trabalha por contrato e por NOTA; a emissao do
-- boleto trabalha por LANCAMENTO A RECEBER. A ponte entre os dois ja existia
-- nos dados — finance.lancamentos.origem_ref_id aponta para a nota — mas nao
-- havia como percorre-la a partir da tela, e o botao 'Emitir boleto' ficou
-- como aviso de 'automacao ainda nao implementada'.
--
-- Sem p_user_id nao da: o schema finance nao e exposto ao PostgREST e a rota
-- precisa saber se a pessoa pode. Mesma capacidade que bol_preparar exige.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bol_lancamento_da_nota(p_user_id uuid, p_nota_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_row finance.lancamentos%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage') THEN
    RAISE EXCEPTION 'Sem permissão para emitir boleto';
  END IF;

  -- Cancelado nao vira boleto: a nota foi desfeita, cobrar seria erro.
  SELECT * INTO v_row FROM finance.lancamentos
   WHERE tenant_id = v_tenant
     AND natureza = 'receber'
     AND origem_ref_id = p_nota_id
     AND status <> 'cancelado'
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('encontrado', false,
      'motivo', 'Esta nota ainda não tem conta a receber. Gere o faturamento antes de emitir o boleto.');
  END IF;

  RETURN jsonb_build_object(
    'encontrado', true,
    'lancamento_id', v_row.id,
    'descricao', v_row.descricao,
    'valor', v_row.valor,
    'vencimento', v_row.vencimento,
    'ja_baixado', v_row.status IN ('pago','recebido')
  );
END $$;

REVOKE ALL ON FUNCTION public.bol_lancamento_da_nota(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bol_lancamento_da_nota(uuid, uuid) TO authenticated, service_role;
