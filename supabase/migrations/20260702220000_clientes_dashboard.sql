-- Dashboard de Clientes: total + quebras (tipo PF/PJ, estado, segmento, grupo econômico, potencial).
CREATE OR REPLACE FUNCTION public.get_clientes_dashboard(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, crm, core AS $function$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = COALESCE(auth.uid(), p_user_id) AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM crm.clientes WHERE tenant_id = v_tenant AND ativo),
    'por_tipo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label',
        CASE tipo::text WHEN 'pessoa_fisica' THEN 'Pessoa física' WHEN 'pessoa_juridica' THEN 'Pessoa jurídica' ELSE COALESCE(tipo::text, 'Não informado') END,
        'count', n) ORDER BY n DESC)
      FROM (SELECT tipo, count(*) n FROM crm.clientes WHERE tenant_id = v_tenant AND ativo GROUP BY tipo) s), '[]'::jsonb),
    'por_estado', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(NULLIF(estado, ''), 'Não informado'), 'count', n) ORDER BY n DESC)
      FROM (SELECT estado, count(*) n FROM crm.clientes WHERE tenant_id = v_tenant AND ativo GROUP BY estado) s), '[]'::jsonb),
    'por_segmento', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', nome, 'count', n) ORDER BY n DESC)
      FROM (SELECT seg.nome, count(*) n
            FROM crm.clientes_segmentos cs
            JOIN crm.segmentos_economicos seg ON seg.id = cs.segmento_id
            JOIN crm.clientes c ON c.id = cs.cliente_id
            WHERE c.tenant_id = v_tenant AND c.ativo GROUP BY seg.nome) s), '[]'::jsonb),
    'por_grupo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(g.nome, 'Sem grupo'), 'count', s.n) ORDER BY s.n DESC)
      FROM (SELECT grupo_economico_id, count(*) n FROM crm.clientes WHERE tenant_id = v_tenant AND ativo GROUP BY grupo_economico_id) s
      LEFT JOIN crm.grupos_economicos g ON g.id = s.grupo_economico_id), '[]'::jsonb),
    'por_potencial', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label',
        CASE potencial_cliente WHEN 'baixo' THEN 'Baixo' WHEN 'medio' THEN 'Médio' WHEN 'alto' THEN 'Alto' ELSE 'Não informado' END,
        'count', n) ORDER BY n DESC)
      FROM (SELECT potencial_cliente, count(*) n FROM crm.clientes WHERE tenant_id = v_tenant AND ativo GROUP BY potencial_cliente) s), '[]'::jsonb)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_clientes_dashboard(uuid) TO authenticated, service_role;
