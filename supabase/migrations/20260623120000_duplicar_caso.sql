-- Contratos / Fase C: duplicar caso.
-- Copia um caso existente para um contrato destino (sem anexos), remapeando os
-- pagadores para o cliente do contrato destino. numero é auto (sequence).

-- ── Clientes que possuem casos (para o filtro de origem) ────────────────────
CREATE OR REPLACE FUNCTION public.get_clientes_com_casos(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', cli.id, 'nome', cli.nome) ORDER BY cli.nome)
    FROM crm.clientes cli
    WHERE cli.tenant_id = v_tenant_id
      AND EXISTS (
        SELECT 1 FROM contracts.contratos ct
        JOIN contracts.casos c ON c.contrato_id = ct.id
        WHERE ct.cliente_id = cli.id AND ct.tenant_id = v_tenant_id
      )
  ), '[]'::jsonb);
END;
$function$;

-- ── Casos e contratos de um cliente (origem e destino) ──────────────────────
CREATE OR REPLACE FUNCTION public.get_cliente_casos_contratos(p_user_id uuid, p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN jsonb_build_object(
    'casos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero', c.numero, 'nome', c.nome, 'contrato_nome', ct.nome_contrato
      ) ORDER BY c.numero DESC)
      FROM contracts.casos c
      JOIN contracts.contratos ct ON ct.id = c.contrato_id
      WHERE ct.cliente_id = p_cliente_id AND c.tenant_id = v_tenant_id AND c.parte_de_carteira_id IS NULL
    ), '[]'::jsonb),
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ct.id, 'numero', ct.numero, 'numero_sequencial', ct.numero_sequencial, 'nome', ct.nome_contrato
      ) ORDER BY ct.numero DESC)
      FROM contracts.contratos ct
      WHERE ct.cliente_id = p_cliente_id AND ct.tenant_id = v_tenant_id AND ct.status = 'ativo'
    ), '[]'::jsonb)
  );
END;
$function$;

-- ── Duplicar o caso ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.duplicate_caso(p_user_id uuid, p_origem_caso_id uuid, p_contrato_destino_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_dest_cliente uuid;
  v_new_id uuid;
  v_new_numero bigint;
  o contracts.casos%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO o FROM contracts.casos WHERE id = p_origem_caso_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caso de origem não encontrado'; END IF;

  SELECT cliente_id INTO v_dest_cliente FROM contracts.contratos
  WHERE id = p_contrato_destino_id AND tenant_id = v_tenant_id AND status = 'ativo';
  IF v_dest_cliente IS NULL THEN RAISE EXCEPTION 'Contrato destino não encontrado ou inativo'; END IF;

  INSERT INTO contracts.casos (
    tenant_id, contrato_id, nome, produto_id, responsavel_id, moeda, tipo_cobranca_documento,
    data_inicio_faturamento, pagamento_dia_mes, inicio_vigencia, periodo_reajuste,
    data_proximo_reajuste, data_ultimo_reajuste, indice_reajuste, regra_cobranca,
    regra_cobranca_config, centro_custo_rateio, pagadores_servico, despesas_config,
    pagadores_despesa, timesheet_config, indicacao_config, servico_id, regras_financeiras,
    possui_reajuste, possui_cap_horas, observacao, dia_inicio_faturamento, polo,
    status, ativo, created_by, updated_by
  ) VALUES (
    v_tenant_id, p_contrato_destino_id, o.nome || ' (cópia)', o.produto_id, o.responsavel_id, o.moeda, o.tipo_cobranca_documento,
    o.data_inicio_faturamento, o.pagamento_dia_mes, o.inicio_vigencia, o.periodo_reajuste,
    o.data_proximo_reajuste, o.data_ultimo_reajuste, o.indice_reajuste, o.regra_cobranca,
    o.regra_cobranca_config, o.centro_custo_rateio,
    -- remapeia os pagadores para o cliente do contrato destino (mantém percentuais)
    CASE WHEN jsonb_typeof(o.pagadores_servico) = 'array' THEN COALESCE((
      SELECT jsonb_agg(jsonb_set(e, '{cliente_id}', to_jsonb(v_dest_cliente::text)))
      FROM jsonb_array_elements(o.pagadores_servico) e
    ), o.pagadores_servico) ELSE o.pagadores_servico END,
    o.despesas_config,
    CASE WHEN jsonb_typeof(o.pagadores_despesa) = 'array' THEN COALESCE((
      SELECT jsonb_agg(jsonb_set(e, '{cliente_id}', to_jsonb(v_dest_cliente::text)))
      FROM jsonb_array_elements(o.pagadores_despesa) e
    ), o.pagadores_despesa) ELSE o.pagadores_despesa END,
    o.timesheet_config, o.indicacao_config, o.servico_id, o.regras_financeiras,
    o.possui_reajuste, o.possui_cap_horas, o.observacao, o.dia_inicio_faturamento, o.polo,
    'ativo', true, p_user_id, p_user_id
  ) RETURNING id, numero INTO v_new_id, v_new_numero;

  RETURN jsonb_build_object('id', v_new_id, 'numero', v_new_numero, 'contrato_id', p_contrato_destino_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_clientes_com_casos(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cliente_casos_contratos(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_caso(uuid, uuid, uuid) TO authenticated, service_role;
