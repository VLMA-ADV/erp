-- Item 5 daily 2026-05-07: revisor automático por centro de custo (filtro area_id).
--
-- PR #97 já implementou a UI (caso-form.tsx l.3398: ChoiceCards revisores_modo
-- 'manual' vs 'auto_centro_custo' persistido em casos.timesheet_config jsonb).
-- Falta o backend honrar o modo automático.
--
-- Regra: quando o caso tem timesheet_config->>'revisores_modo' = 'auto_centro_custo',
-- usuários NÃO admin/socio enxergam timesheets de OUTROS colaboradores cuja
-- area_id bata com a sua. Decisão de produto: sem schema novo (sem coluna
-- is_coordenador, sem tabela area_coordenadores) — apenas lookup direto em
-- people.colaboradores.area_id já existente.
--
-- Modo manual (default) preserva comportamento atual: viewer só vê próprios
-- lançamentos a menos que seja admin/socio ou tenha permissão wildcard.

CREATE OR REPLACE FUNCTION public.get_timesheets(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT (
    public.is_admin_or_socio(p_user_id, v_tenant_id)
    OR EXISTS (
      SELECT 1
      FROM public.get_user_permissions(p_user_id) p
      WHERE p.permission_key IN (
        'operations.timesheet.manage',
        'operations.timesheet.*',
        'operations.*',
        '*'
      )
    )
  ) INTO v_can_view_all;

  -- area_id do viewer (resolvida 1× por chamada para evitar lookup por linha)
  SELECT col.area_id INTO v_viewer_area_id
  FROM people.colaboradores col
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

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
          -- Item 5: revisor automático por centro de custo. Caso configurado
          -- como 'auto_centro_custo' libera viewers com area_id igual à do
          -- criador do lançamento. v_viewer_area_id NULL → sem match (viewer
          -- sem área não cobre ninguém).
          v_viewer_area_id IS NOT NULL
          AND cs.timesheet_config->>'revisores_modo' = 'auto_centro_custo'
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
$function$;
