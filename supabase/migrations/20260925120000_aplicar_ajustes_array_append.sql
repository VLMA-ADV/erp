-- Filipe (24/09): 'malformed array literal: "pagadores"' ao salvar impostos/
-- pagadores no kit. v_mudou e text[] e 'v_mudou || ''pagadores''' faz o Postgres
-- ler o texto como literal de array. Vale para todos os quatro ramos, ou seja,
-- 'Salvar no cadastro' nunca funcionou nem na previa da NF. array_append resolve.
CREATE OR REPLACE FUNCTION public.aplicar_ajustes_no_cadastro(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_pagadores jsonb DEFAULT NULL::jsonb, p_grupo_imposto_id uuid DEFAULT NULL::uuid, p_dia_pagamento integer DEFAULT NULL::integer, p_valor_fixo numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_mudou text[] := '{}';
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o contrato';
  END IF;

  IF p_grupo_imposto_id IS NOT NULL THEN
    UPDATE contracts.contratos SET grupo_imposto_id = p_grupo_imposto_id, updated_at = now()
     WHERE id = p_contrato_id AND tenant_id = v_tenant;
    v_mudou := array_append(v_mudou, 'grupo de impostos');
  END IF;

  IF p_caso_id IS NOT NULL AND p_pagadores IS NOT NULL THEN
    UPDATE contracts.casos SET pagadores_servico = p_pagadores, updated_at = now()
     WHERE id = p_caso_id AND tenant_id = v_tenant;
    v_mudou := array_append(v_mudou, 'pagadores');
  END IF;

  IF p_caso_id IS NOT NULL AND p_dia_pagamento IS NOT NULL THEN
    UPDATE contracts.casos SET pagamento_dia_mes = p_dia_pagamento, updated_at = now()
     WHERE id = p_caso_id AND tenant_id = v_tenant;
    v_mudou := array_append(v_mudou, 'dia de pagamento');
  END IF;

  -- Valor fixo mora na regra do caso. Mexe so na primeira regra (a que a fila
  -- e o gerador usam) e so quando ela ja existe: criar regra aqui, no meio de
  -- uma emissao, seria mudar o contrato pelas costas de quem cadastrou.
  IF p_caso_id IS NOT NULL AND p_valor_fixo IS NOT NULL THEN
    UPDATE contracts.casos cs
       SET regras_financeiras = jsonb_set(
             cs.regras_financeiras, '{0,regra_cobranca_config,valor_fixo}', to_jsonb(p_valor_fixo)),
           updated_at = now()
     WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant
       AND jsonb_typeof(cs.regras_financeiras) = 'array'
       AND jsonb_array_length(cs.regras_financeiras) > 0;
    IF FOUND THEN v_mudou := array_append(v_mudou, 'valor fixo'); END IF;
  END IF;

  RETURN jsonb_build_object('alterado', v_mudou);
END $function$
;
