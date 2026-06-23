-- Colaboradores: filtro por centro de custo (area_id) na RPC.
-- O filtro por área falhava porque a edge function tentava acessar
-- people.colaboradores direto pelo PostgREST (schema não exposto). Passa a ser
-- feito na RPC list_colaboradores.

DROP FUNCTION IF EXISTS public.list_colaboradores(uuid, text, integer, integer);

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

GRANT EXECUTE ON FUNCTION public.list_colaboradores(uuid, text, integer, integer, uuid) TO authenticated, service_role;
