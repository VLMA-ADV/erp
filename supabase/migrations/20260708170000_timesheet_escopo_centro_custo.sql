-- Escopo de acesso às horas de timesheet por centro de custo (regra do cliente):
-- * Sócio DIRETOR (centro de custo = 'VLMA' ou sem área) -> vê todas as horas.
-- * Sócio/coordenador de uma ÁREA específica -> vê apenas as horas das PESSOAS
--   do seu centro de custo (área do autor da hora = área do gestor).
-- * Demais -> apenas as próprias.
-- Antes, is_admin_or_socio() dava v_can_view_all a QUALQUER sócio, então um
-- coordenador-sócio (ex.: Leo/Tributário) via o escritório inteiro.

CREATE OR REPLACE FUNCTION public.get_timesheets(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
  v_is_admin_socio boolean := false;
  v_eh_coord boolean := false;
  v_is_gestor boolean := false;
  v_has_manage_perm boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_is_admin_socio := public.is_admin_or_socio(p_user_id, v_tenant_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'operations.timesheet.manage',
      'operations.timesheet.*',
      'operations.*',
      '*'
    )
  ) INTO v_has_manage_perm;

  SELECT col.area_id, a.nome, COALESCE(col.eh_coordenador, false)
  INTO v_viewer_area_id, v_viewer_area_nome, v_eh_coord
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Gestor = sócio/admin OU coordenador de área (vê a própria área).
  v_is_gestor := v_is_admin_socio OR v_eh_coord;

  -- Vê tudo só quem tem permissão explícita de gestão OU é diretor
  -- (centro de custo 'VLMA' ou sem área específica). Sócio/coordenador de
  -- área específica NÃO vê tudo — fica escopado à sua área.
  v_can_view_all := v_has_manage_perm
    OR (v_is_admin_socio AND (v_viewer_area_id IS NULL OR v_viewer_area_nome = 'VLMA'));

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'contrato_id', t.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_nome', ct.nome_contrato,
        'caso_id', t.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'data_lancamento', t.data_lancamento,
        'horas', t.horas,
        'descricao', t.descricao,
        'status', t.status,
        'created_by', t.created_by,
        'created_by_nome', cb.nome,
        'revisado_por', t.revisado_por,
        'aprovado_por', t.aprovado_por,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      )
      ORDER BY t.data_lancamento DESC, t.created_at DESC
    )
    FROM operations.timesheets t
    JOIN contracts.contratos ct ON ct.id = t.contrato_id
    JOIN contracts.casos cs ON cs.id = t.caso_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = t.created_by AND cb.tenant_id = t.tenant_id
    WHERE t.tenant_id = v_tenant_id
      AND (
        v_can_view_all
        OR t.created_by = p_user_id
        OR (
          -- gestor de área específica vê as horas das pessoas do seu centro de custo
          v_is_gestor
          AND v_viewer_area_id IS NOT NULL
          AND cb.area_id = v_viewer_area_id
        )
      )
      AND (
        NULLIF(p_filters->>'contrato_id', '') IS NULL
        OR t.contrato_id = (p_filters->>'contrato_id')::uuid
      )
      AND (
        NULLIF(p_filters->>'caso_id', '') IS NULL
        OR t.caso_id = (p_filters->>'caso_id')::uuid
      )
      AND (
        NULLIF(p_filters->>'status', '') IS NULL
        OR t.status = (p_filters->>'status')
      )
      AND (
        NULLIF(p_filters->>'data_inicio', '') IS NULL
        OR t.data_lancamento >= (p_filters->>'data_inicio')::date
      )
      AND (
        NULLIF(p_filters->>'data_fim', '') IS NULL
        OR t.data_lancamento <= (p_filters->>'data_fim')::date
      )
  ), '[]'::jsonb);
END;
$function$
;

NOTIFY pgrst, 'reload schema';
