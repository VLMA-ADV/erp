-- Módulo Colaboradores: foto (avatar) + minidashboard.
-- Foto fica no Supabase Storage (bucket colaboradores-fotos); a coluna guarda o
-- link público. Dashboard via RPC (schema people não é exposto ao PostgREST).

ALTER TABLE people.colaboradores ADD COLUMN IF NOT EXISTS foto_url text;

-- ── list_colaboradores: + foto_url, salario, categoria, area, adicional ──────
DROP FUNCTION IF EXISTS public.list_colaboradores(uuid, text, integer, integer);
CREATE FUNCTION public.list_colaboradores(p_tenant_id uuid, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 10)
 RETURNS TABLE(
   id uuid, nome text, email text, whatsapp text, ativo boolean,
   cargo_id uuid, cargo_nome text,
   foto_url text, salario numeric,
   categoria text, area_id uuid, area_nome text, adicional text,
   total_count bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_offset INTEGER;
BEGIN
  v_offset := (p_page - 1) * p_limit;

  RETURN QUERY
  SELECT
    c.id,
    c.nome::text,
    c.email::text,
    COALESCE(c.whatsapp, '')::text AS whatsapp,
    c.ativo,
    c.cargo_id,
    COALESCE(ca.nome, '')::text AS cargo_nome,
    c.foto_url,
    c.salario,
    c.categoria::text,
    c.area_id,
    COALESCE(ar.nome, '')::text AS area_nome,
    c.adicional::text,
    COUNT(*) OVER () AS total_count
  FROM people.colaboradores c
  LEFT JOIN people.cargos ca ON ca.id = c.cargo_id
  LEFT JOIN people.areas ar ON ar.id = c.area_id
  WHERE c.tenant_id = p_tenant_id
    AND (
      p_search IS NULL
      OR c.nome ILIKE '%' || p_search || '%'
      OR c.email ILIKE '%' || p_search || '%'
    )
  ORDER BY c.nome ASC
  LIMIT p_limit
  OFFSET v_offset;
END;
$function$;

-- ── set_colaborador_foto: grava o link da foto (escopo por tenant) ──────────
CREATE OR REPLACE FUNCTION public.set_colaborador_foto(p_user_id uuid, p_colaborador_id uuid, p_foto_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  UPDATE people.colaboradores
  SET foto_url = p_foto_url, updated_at = now(), updated_by = p_user_id
  WHERE id = p_colaborador_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_colaborador_id, 'foto_url', p_foto_url);
END;
$function$;

-- ── get_colaboradores_dashboard: total + contagens por dimensão ─────────────
CREATE OR REPLACE FUNCTION public.get_colaboradores_dashboard(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo),
    'por_categoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', categoria::text, 'count', n) ORDER BY n DESC)
      FROM (SELECT categoria, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY categoria) s
    ), '[]'::jsonb),
    'por_cargo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(ca.nome, 'Sem cargo'), 'count', s.n) ORDER BY s.n DESC)
      FROM (SELECT cargo_id, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY cargo_id) s
      LEFT JOIN people.cargos ca ON ca.id = s.cargo_id
    ), '[]'::jsonb),
    'por_centro_custo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(ar.nome, 'Sem centro de custo'), 'count', s.n) ORDER BY s.n DESC)
      FROM (SELECT area_id, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY area_id) s
      LEFT JOIN people.areas ar ON ar.id = s.area_id
    ), '[]'::jsonb),
    'por_adicional', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(adicional::text, 'Nenhuma'), 'count', n) ORDER BY n DESC)
      FROM (SELECT adicional, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY adicional) s
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_colaborador_foto(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_colaboradores_dashboard(uuid) TO authenticated, service_role;

-- ── Storage: bucket público para as fotos ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('colaboradores-fotos', 'colaboradores-fotos', true)
ON CONFLICT (id) DO NOTHING;
