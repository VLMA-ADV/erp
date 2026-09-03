-- =====================================================================
-- Cancelar a NF devolve os itens para revisao
--
-- Filipe, 03/09: "esse lancamento eu cancelei a NF e ai ele nao me permite
-- alterar novamente na etapa de revisao".
--
-- cancelar-nfse marcava a nota como cancelada e parava ali. O billing_item
-- ficava em 'faturado' — estado final — entao a revisao nao deixava mexer, e o
-- caso ficava travado sem nota valida e sem como refazer. Mesma familia do
-- 'Zerar faturamento nao devolvia a despesa' (01/09): a acao desfazia metade.
--
-- Devolve para 'em_revisao', que e o estado de onde se refaz. O timesheet
-- acompanha, senao ele ficaria 'aprovado' apontando para um item em revisao.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bol_devolver_itens_da_nota(p_user_id uuid, p_nota_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'operations', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_itens int := 0;
  v_ts int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  SELECT * INTO v_nota FROM finance.billing_notes
   WHERE id = p_nota_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;

  -- Só devolve item que estava faturado POR ESTA nota. Item de outra nota do
  -- mesmo contrato continua onde está.
  UPDATE finance.billing_items bi
     SET status = 'em_revisao', updated_at = now(), updated_by = p_user_id
   WHERE bi.tenant_id = v_tenant
     AND bi.status = 'faturado'
     AND (
       (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
       OR (v_nota.caso_id IS NULL AND v_nota.contrato_id IS NOT NULL
           AND bi.contrato_id = v_nota.contrato_id)
     );
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  -- A hora acompanha o item: 'aprovado' apontando para item em revisão é um
  -- estado que nenhuma tela sabe mostrar.
  UPDATE operations.timesheets t
     SET status = 'revisao', updated_at = now(), updated_by = p_user_id
   WHERE t.tenant_id = v_tenant
     AND t.status = 'aprovado'
     AND t.id IN (
       SELECT bi.origem_id FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant
          AND bi.origem_tipo = 'timesheet'
          AND bi.status = 'em_revisao'
          AND (
            (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
            OR (v_nota.caso_id IS NULL AND v_nota.contrato_id IS NOT NULL
                AND bi.contrato_id = v_nota.contrato_id)
          )
     );
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  RETURN jsonb_build_object('itens_devolvidos', v_itens, 'horas_devolvidas', v_ts);
END $$;

REVOKE ALL ON FUNCTION public.bol_devolver_itens_da_nota(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bol_devolver_itens_da_nota(uuid, uuid) TO authenticated, service_role;
