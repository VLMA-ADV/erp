-- Escopo de visibilidade das despesas (pedido Filipe 22/07):
-- "cada usuário vê apenas os seus lançamentos de despesas, com exceção do sócio
--  e coordenador que vê tudo do seu centro de custo".
--
-- Espelha EXATAMENTE a regra já aplicada ao timesheet em
-- 20260708170000_timesheet_escopo_centro_custo.sql:
--   * diretor (sócio de centro de custo 'VLMA'/sem área) ou quem tem permissão
--     de gestão => vê todas as despesas;
--   * coordenador/sócio de área específica => vê as despesas de quem é da sua área;
--   * demais => apenas as despesas que ele mesmo lançou (created_by).
-- Também pinamos search_path (estava solto — hardening).

CREATE OR REPLACE FUNCTION public.get_despesas(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people', 'operations', 'contracts', 'crm'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_is_admin_socio boolean := false;
  v_has_manage_perm boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
  v_eh_coord boolean := false;
  v_is_gestor boolean := false;
  v_can_view_all boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  v_is_admin_socio := public.is_admin_or_socio(p_user_id, v_tenant_id);

  -- Permissão explícita de gestão (despesas ou faturamento) => vê tudo.
  -- Inclui finance.* para não quebrar a visão do time de faturamento.
  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'operations.despesas.manage',
      'operations.despesas.*',
      'operations.*',
      'finance.faturamento.manage',
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.*',
      '*'
    )
  ) INTO v_has_manage_perm;

  SELECT col.area_id, a.nome, COALESCE(col.eh_coordenador, false)
  INTO v_viewer_area_id, v_viewer_area_nome, v_eh_coord
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Gestor = sócio/admin OU coordenador de área.
  v_is_gestor := v_is_admin_socio OR v_eh_coord;

  -- Vê tudo só quem tem permissão de gestão OU é diretor
  -- (centro de custo 'VLMA' ou sem área). Sócio/coordenador de área específica
  -- fica escopado à sua área.
  v_can_view_all := v_has_manage_perm
    OR (v_is_admin_socio AND (v_viewer_area_id IS NULL OR v_viewer_area_nome = 'VLMA'));

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'contrato_id', d.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_numero_sequencial', ct.numero_sequencial,
        'contrato_nome', ct.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'cliente_id', ct.cliente_id,
        'cliente_nome', cli.nome,
        'data_lancamento', d.data_lancamento,
        'categoria', d.categoria,
        'valor', COALESCE(d.valor, 0),
        'descricao', d.descricao,
        'status', d.status,
        'reembolsavel', COALESCE(d.reembolsavel, true),
        'arquivo_nome', d.arquivo_nome,
        'mime_type', d.mime_type,
        'tamanho_bytes', d.tamanho_bytes,
        'anexos', (
          SELECT jsonb_agg(item ORDER BY ord)
          FROM (
            SELECT 0 AS ord, jsonb_build_object(
              'id', d.id, 'kind', 'primario',
              'arquivo_nome', d.arquivo_nome, 'mime_type', d.mime_type, 'tamanho_bytes', d.tamanho_bytes
            ) AS item
            WHERE d.arquivo_nome IS NOT NULL
            UNION ALL
            SELECT 1 AS ord, jsonb_build_object(
              'id', a.id, 'kind', 'extra',
              'arquivo_nome', a.arquivo_nome, 'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes
            )
            FROM operations.despesa_anexos a
            WHERE a.despesa_id = d.id
          ) s
        ),
        'created_by', d.created_by,
        'created_by_nome', cb.nome,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      )
      ORDER BY d.data_lancamento DESC, d.created_at DESC
    )
    FROM operations.despesas d
    JOIN contracts.contratos ct ON ct.id = d.contrato_id
    JOIN contracts.casos cs ON cs.id = d.caso_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = d.created_by AND cb.tenant_id = d.tenant_id
    WHERE d.tenant_id = v_tenant_id
      AND (
        v_can_view_all
        OR d.created_by = p_user_id
        OR (
          -- gestor de área específica vê as despesas das pessoas do seu centro de custo
          v_is_gestor
          AND v_viewer_area_id IS NOT NULL
          AND cb.area_id = v_viewer_area_id
        )
      )
      AND (NULLIF(p_filters->>'contrato_id', '') IS NULL OR d.contrato_id = (p_filters->>'contrato_id')::uuid)
      AND (NULLIF(p_filters->>'caso_id', '') IS NULL OR d.caso_id = (p_filters->>'caso_id')::uuid)
      AND (NULLIF(p_filters->>'status', '') IS NULL OR d.status = p_filters->>'status')
      AND (NULLIF(p_filters->>'categoria', '') IS NULL OR lower(d.categoria) = lower(p_filters->>'categoria'))
      AND (NULLIF(p_filters->>'data_inicio', '') IS NULL OR d.data_lancamento >= (p_filters->>'data_inicio')::date)
      AND (NULLIF(p_filters->>'data_fim', '') IS NULL OR d.data_lancamento <= (p_filters->>'data_fim')::date)
  ), '[]'::jsonb);
END;
$function$;
