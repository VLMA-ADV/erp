-- Migration: Create get_colaborador_complete RPC function
-- Retorna colaborador + roles + permissões + benefícios em uma única query otimizada

CREATE OR REPLACE FUNCTION public.get_colaborador_complete(
  p_user_id uuid,
  p_colaborador_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $$
DECLARE
  v_tenant_id UUID;
  v_colaborador_row RECORD;
  v_result JSON;
BEGIN
  -- Buscar tenant do usuário
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with tenant';
  END IF;

  -- Buscar dados do colaborador
  SELECT 
    c.id,
    c.tenant_id,
    c.user_id,
    c.nome,
    c.email,
    c.cpf,
    c.data_nascimento,
    c.categoria,
    COALESCE(c.oab, '') as oab,
    COALESCE(c.whatsapp, '') as whatsapp,
    COALESCE(c.cep, '') as cep,
    COALESCE(c.rua, '') as rua,
    COALESCE(c.numero, '') as numero,
    COALESCE(c.complemento, '') as complemento,
    COALESCE(c.cidade, '') as cidade,
    COALESCE(c.estado, '') as estado,
    c.cargo_id,
    c.area_id,
    c.adicional,
    c.percentual_adicional,
    c.salario,
    COALESCE(c.conta_contabil, '') as conta_contabil,
    COALESCE(c.skills, ARRAY[]::text[]) as skills,
    COALESCE(c.banco, '') as banco,
    COALESCE(c.agencia, '') as agencia,
    COALESCE(c.conta_com_digito, '') as conta_com_digito,
    COALESCE(c.chave_pix, '') as chave_pix,
    c.ativo,
    c.created_at,
    c.updated_at,
    c.created_by,
    c.updated_by,
    car.nome as cargo_nome,
    ar.nome as area_nome
  INTO v_colaborador_row
  FROM people.colaboradores c
  LEFT JOIN people.cargos car ON car.id = c.cargo_id
  LEFT JOIN people.areas ar ON ar.id = c.area_id
  WHERE c.id = p_colaborador_id
    AND c.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador not found';
  END IF;

  -- Construir JSON completo com todos os dados relacionados
  SELECT json_build_object(
    'id', v_colaborador_row.id,
    'tenant_id', v_colaborador_row.tenant_id,
    'user_id', v_colaborador_row.user_id,
    'nome', v_colaborador_row.nome,
    'email', v_colaborador_row.email,
    'cpf', v_colaborador_row.cpf,
    'data_nascimento', v_colaborador_row.data_nascimento,
    'categoria', v_colaborador_row.categoria,
    'oab', v_colaborador_row.oab,
    'whatsapp', v_colaborador_row.whatsapp,
    'cep', v_colaborador_row.cep,
    'rua', v_colaborador_row.rua,
    'numero', v_colaborador_row.numero,
    'complemento', v_colaborador_row.complemento,
    'cidade', v_colaborador_row.cidade,
    'estado', v_colaborador_row.estado,
    'cargo_id', v_colaborador_row.cargo_id,
    'area_id', v_colaborador_row.area_id,
    'adicional', v_colaborador_row.adicional,
    'percentual_adicional', v_colaborador_row.percentual_adicional,
    'salario', v_colaborador_row.salario,
    'conta_contabil', v_colaborador_row.conta_contabil,
    'skills', v_colaborador_row.skills,
    'banco', v_colaborador_row.banco,
    'agencia', v_colaborador_row.agencia,
    'conta_com_digito', v_colaborador_row.conta_com_digito,
    'chave_pix', v_colaborador_row.chave_pix,
    'ativo', v_colaborador_row.ativo,
    'created_at', v_colaborador_row.created_at,
    'updated_at', v_colaborador_row.updated_at,
    'created_by', v_colaborador_row.created_by,
    'updated_by', v_colaborador_row.updated_by,
    'cargos', CASE 
      WHEN v_colaborador_row.cargo_nome IS NOT NULL 
      THEN json_build_object('nome', v_colaborador_row.cargo_nome)
      ELSE NULL 
    END,
    'areas', CASE 
      WHEN v_colaborador_row.area_nome IS NOT NULL 
      THEN json_build_object('nome', v_colaborador_row.area_nome)
      ELSE NULL 
    END,
    'colaboradores_beneficios', (
      SELECT COALESCE(json_agg(json_build_object('beneficio', cb.beneficio)), '[]'::json)
      FROM people.colaboradores_beneficios cb
      WHERE cb.colaborador_id = p_colaborador_id
    ),
    'user_roles', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'role_id', ur.role_id,
            'role_nome', r.nome
          )
        ),
        '[]'::json
      )
      FROM core.user_roles ur
      JOIN core.roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_colaborador_row.user_id
        AND ur.tenant_id = v_tenant_id
    ),
    'permissions', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'permission_id', p.id,
            'chave', p.chave,
            'descricao', p.descricao,
            'categoria', p.categoria
          )
        ),
        '[]'::json
      )
      FROM (
        -- Permissões de roles
        SELECT DISTINCT p.id, p.chave, p.descricao, p.categoria
        FROM core.user_roles ur
        JOIN core.role_permissions rp ON ur.role_id = rp.role_id
        JOIN core.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = v_colaborador_row.user_id
          AND ur.tenant_id = v_tenant_id
          AND p.tenant_id = v_tenant_id
        
        UNION
        
        -- Permissões diretas do usuário
        SELECT DISTINCT p.id, p.chave, p.descricao, p.categoria
        FROM core.user_permissions up
        JOIN core.permissions p ON up.permission_id = p.id
        WHERE up.user_id = v_colaborador_row.user_id
          AND up.tenant_id = v_tenant_id
          AND p.tenant_id = v_tenant_id
      ) p
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_colaborador_complete(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_colaborador_complete(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.get_colaborador_complete IS 'Retorna todos os dados do colaborador (dados pessoais, roles, permissões, benefícios) em uma única query otimizada';
