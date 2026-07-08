-- Drill de indicadores de Contratos: retornar contrato_id para o front poder
-- tornar cada "Contrato N" clicável (abre o contrato). Só adiciona a chave
-- 'contrato_id' nos json_build_object; lógica inalterada.

CREATE OR REPLACE FUNCTION public.get_contratos_dashboard_drill(
  p_tenant_id uuid, p_dim text, p_valor text, p_ref_month date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, contracts, crm, finance, people, operations
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ms date := date_trunc('month', COALESCE(p_ref_month, v_now))::date;
  v_me date := (date_trunc('month', COALESCE(p_ref_month, v_now)) + interval '1 month')::date;
  v_result json;
BEGIN
  IF p_dim = 'por_cliente_top' THEN
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id AND ct.status = 'ativo' AND cli.nome = p_valor;
  ELSIF p_dim = 'por_status' THEN
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id AND COALESCE(ct.status, 'sem status') = p_valor;
  ELSE
    -- dimensões baseadas em casos
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', c.nome) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.casos c
    JOIN contracts.contratos ct ON ct.id = c.contrato_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores p ON p.id = c.responsavel_id
    LEFT JOIN operations.categorias_servico sv ON sv.id = c.servico_id
    LEFT JOIN contracts.produtos pd ON pd.id = c.produto_id
    WHERE c.tenant_id = p_tenant_id AND c.parte_de_carteira_id IS NULL
      AND (
        (p_dim = 'por_responsavel' AND c.status='ativo' AND COALESCE(p.nome,'Sem responsável') = p_valor) OR
        (p_dim = 'por_servico'     AND c.status='ativo' AND COALESCE(sv.nome,'Sem serviço') = p_valor) OR
        (p_dim = 'por_produto'     AND c.status='ativo' AND COALESCE(pd.nome,'Sem produto') = p_valor) OR
        (p_dim = 'por_centro_custo' AND c.status='ativo' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.centro_custo_rateio)='array' THEN c.centro_custo_rateio ELSE '[]'::jsonb END
          ) rr
          LEFT JOIN people.areas ar2 ON ar2.id = NULLIF(rr->>'centro_custo_id','')::uuid
          WHERE COALESCE(ar2.nome, NULLIF(rr->>'centro_custo_nome',''), 'Sem centro de custo') = p_valor
        )) OR
        (p_dim = 'por_regra_cobranca_mes'
          AND COALESCE(NULLIF(c.regra_cobranca,''),'Sem regra') = p_valor
          AND c.created_at >= v_ms::timestamptz AND c.created_at < v_me::timestamptz)
      )
    LIMIT 200;
  END IF;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_contratos_dashboard_drill(uuid, text, text, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
