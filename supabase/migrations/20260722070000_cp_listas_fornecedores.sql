-- Contas a pagar/receber — expõe a lista de fornecedores no cp_listas para o
-- campo "Fornecedor" virar uma lista (autocomplete) no formulário de lançamento.
-- Antes o campo era texto livre. finance.lancamentos guarda só fornecedor_nome
-- (texto), então nada muda no backend de gravação — a lista é só para escolher.

CREATE OR REPLACE FUNCTION public.cp_listas(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE v_tenant uuid; v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão para o módulo financeiro';
  END IF;

  SELECT jsonb_build_object(
    'centros_custo', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
       FROM finance.centros_custo WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'contas_contabeis', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome, 'centro_custo_id', centro_custo_id) ORDER BY codigo)
       FROM finance.contas_contabeis WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'empresas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
       FROM finance.empresas_grupo WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'plano_contas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'grupo', grupo, 'sintetica', sintetica, 'analitica', analitica, 'natureza', natureza) ORDER BY codigo)
       FROM finance.plano_contas WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'contas_bancarias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'banco', banco, 'descricao', descricao, 'saldo_abertura', saldo_abertura, 'saldo_abertura_data', saldo_abertura_data) ORDER BY banco)
       FROM finance.contas_bancarias WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'fornecedores', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome_fornecedor) ORDER BY nome_fornecedor)
       FROM operations.fornecedores WHERE tenant_id = v_tenant AND ativo IS NOT FALSE AND nome_fornecedor IS NOT NULL), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $function$;
