-- Coordenador gerenciável na lista de colaboradores.
-- list_colaboradores passa a retornar eh_coordenador; nova RPC para alternar.

DROP FUNCTION IF EXISTS public.list_colaboradores(uuid, text, integer, integer, uuid);

CREATE FUNCTION public.list_colaboradores(
  p_tenant_id uuid, p_search text DEFAULT NULL::text,
  p_page integer DEFAULT 1, p_limit integer DEFAULT 10,
  p_area_id uuid DEFAULT NULL
)
 RETURNS TABLE(
   id uuid, nome text, email text, whatsapp text, ativo boolean,
   cargo_id uuid, cargo_nome text,
   foto_url text, salario numeric,
   categoria text, area_id uuid, area_nome text, adicional text,
   eh_coordenador boolean,
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
    c.id, c.nome::text, c.email::text,
    COALESCE(c.whatsapp, '')::text AS whatsapp,
    c.ativo, c.cargo_id,
    COALESCE(ca.nome, '')::text AS cargo_nome,
    c.foto_url, c.salario,
    c.categoria::text, c.area_id,
    COALESCE(ar.nome, '')::text AS area_nome,
    c.adicional::text,
    c.eh_coordenador,
    COUNT(*) OVER () AS total_count
  FROM people.colaboradores c
  LEFT JOIN people.cargos ca ON ca.id = c.cargo_id
  LEFT JOIN people.areas ar ON ar.id = c.area_id
  WHERE c.tenant_id = p_tenant_id
    AND (p_area_id IS NULL OR c.area_id = p_area_id)
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

CREATE OR REPLACE FUNCTION public.set_colaborador_coordenador(p_user_id uuid, p_colaborador_id uuid, p_eh boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  UPDATE people.colaboradores
  SET eh_coordenador = COALESCE(p_eh, false), updated_at = now(), updated_by = p_user_id
  WHERE id = p_colaborador_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado'; END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_colaborador_id, 'eh_coordenador', COALESCE(p_eh, false));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_colaboradores(uuid, text, integer, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_colaborador_coordenador(uuid, uuid, boolean) TO authenticated, service_role;
