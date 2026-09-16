-- =====================================================================
-- Vencimento escolhido na hora de faturar manda na conta a receber
--
-- Parte do pedido do Filipe de 11/09: "alterar [...] a data de vencimento no
-- momento do faturamento". Quando a emissao grava
-- metadata.vencimento_override, a conta a receber usa essa data em vez da
-- regra do dia do caso (20260904130000).
-- =====================================================================
CREATE OR REPLACE FUNCTION finance.vencimento_para_nota(p_nota_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'finance', 'contracts', 'public'
AS $$
DECLARE
  v_emissao date;
  v_dia int;
  v_cand date;
  v_override date;
BEGIN
  SELECT NULLIF(bn.metadata->>'vencimento_override','')::date INTO v_override
  FROM finance.billing_notes bn WHERE bn.id = p_nota_id;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT bn.created_at::date,
         COALESCE(
           (SELECT cs.pagamento_dia_mes FROM contracts.casos cs WHERE cs.id = bn.caso_id),
           (SELECT cs.pagamento_dia_mes FROM contracts.casos cs
             WHERE cs.contrato_id = bn.contrato_id AND cs.ativo
               AND cs.pagamento_dia_mes IS NOT NULL
             GROUP BY cs.pagamento_dia_mes HAVING count(*) = (
               SELECT count(*) FROM contracts.casos c2
                WHERE c2.contrato_id = bn.contrato_id AND c2.ativo
                  AND c2.pagamento_dia_mes IS NOT NULL)
             LIMIT 1)
         )
    INTO v_emissao, v_dia
  FROM finance.billing_notes bn WHERE bn.id = p_nota_id;

  IF v_emissao IS NULL THEN RETURN NULL; END IF;
  IF v_dia IS NULL OR v_dia < 1 OR v_dia > 31 THEN
    RETURN v_emissao + 7;
  END IF;

  v_cand := finance._dia_no_mes(date_trunc('month', v_emissao)::date, v_dia);
  IF v_cand <= v_emissao THEN
    v_cand := finance._dia_no_mes((date_trunc('month', v_emissao) + interval '1 month')::date, v_dia);
  END IF;
  RETURN v_cand;
END $$;

-- =====================================================================
-- Salvar no contrato os ajustes feitos na emissao (opcao (b) do Filipe)
--
-- Chamada so quando a pessoa marca "salvar também no contrato". Grava o
-- rateio de pagadores no caso, o grupo de impostos no contrato e o dia de
-- pagamento no caso. Valor fixo vai na regra do caso quando ele existir.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.aplicar_ajustes_no_cadastro(
  p_user_id uuid,
  p_contrato_id uuid,
  p_caso_id uuid,
  p_pagadores jsonb DEFAULT NULL,
  p_grupo_imposto_id uuid DEFAULT NULL,
  p_dia_pagamento int DEFAULT NULL,
  p_valor_fixo numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'contracts', 'core'
AS $$
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
    v_mudou := v_mudou || 'grupo de impostos';
  END IF;

  IF p_caso_id IS NOT NULL AND p_pagadores IS NOT NULL THEN
    UPDATE contracts.casos SET pagadores_servico = p_pagadores, updated_at = now()
     WHERE id = p_caso_id AND tenant_id = v_tenant;
    v_mudou := v_mudou || 'pagadores';
  END IF;

  IF p_caso_id IS NOT NULL AND p_dia_pagamento IS NOT NULL THEN
    UPDATE contracts.casos SET pagamento_dia_mes = p_dia_pagamento, updated_at = now()
     WHERE id = p_caso_id AND tenant_id = v_tenant;
    v_mudou := v_mudou || 'dia de pagamento';
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
    IF FOUND THEN v_mudou := v_mudou || 'valor fixo'; END IF;
  END IF;

  RETURN jsonb_build_object('alterado', v_mudou);
END $$;

REVOKE ALL ON FUNCTION public.aplicar_ajustes_no_cadastro(uuid, uuid, uuid, jsonb, uuid, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_ajustes_no_cadastro(uuid, uuid, uuid, jsonb, uuid, int, numeric) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
