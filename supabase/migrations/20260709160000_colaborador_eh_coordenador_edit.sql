-- Bug: campo 'Categoria' (categoria_profissional) na aba Dados Profissionais era
-- fantasma (coluna inexistente, fora da whitelist da edge) -> nunca salvava.
-- Correção: permitir editar eh_coordenador pelo form. (1) get_colaborador_complete
-- passa a devolver eh_coordenador (pré-carregar o toggle); (2) update_colaborador_data
-- grava eh_coordenador quando presente no payload.

-- (1) get_colaborador_complete: expor eh_coordenador
CREATE OR REPLACE FUNCTION public.get_colaborador_complete(p_user_id uuid, p_colaborador_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_colaborador_row RECORD;
  v_result JSON;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with tenant';
  END IF;

  SELECT
    c.id,
    c.tenant_id,
    c.user_id,
    c.nome,
    c.email,
    c.cpf,
    c.data_nascimento,
    c.data_entrada,
    c.data_saida,
    c.categoria,
    c.carreira,
    c.eh_coordenador,
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

  SELECT json_build_object(
    'id', v_colaborador_row.id,
    'tenant_id', v_colaborador_row.tenant_id,
    'user_id', v_colaborador_row.user_id,
    'nome', v_colaborador_row.nome,
    'email', v_colaborador_row.email,
    'cpf', v_colaborador_row.cpf,
    'data_nascimento', v_colaborador_row.data_nascimento,
    'data_entrada', v_colaborador_row.data_entrada,
    'data_saida', v_colaborador_row.data_saida,
    'categoria', v_colaborador_row.categoria,
    'carreira', v_colaborador_row.carreira,
    'eh_coordenador', v_colaborador_row.eh_coordenador,
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
        SELECT DISTINCT p.id, p.chave, p.descricao, p.categoria
        FROM core.user_roles ur
        JOIN core.role_permissions rp ON ur.role_id = rp.role_id
        JOIN core.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = v_colaborador_row.user_id
          AND ur.tenant_id = v_tenant_id
          AND p.tenant_id = v_tenant_id
        UNION
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
$function$
;

-- (2) update_colaborador_data: gravar eh_coordenador quando presente
CREATE OR REPLACE FUNCTION public.update_colaborador_data(p_user_id uuid, p_colaborador_id uuid, p_update_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_colaborador JSON;
  v_clean_cpf VARCHAR(11);
  v_updated_rows INT;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM people.colaboradores c
    WHERE c.id = p_colaborador_id
      AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Colaborador not found';
  END IF;

  IF p_update_data ? 'cpf' AND p_update_data->>'cpf' IS NOT NULL THEN
    v_clean_cpf := regexp_replace(p_update_data->>'cpf', '[^0-9]', '', 'g');
    IF length(v_clean_cpf) > 11 THEN
      RAISE EXCEPTION 'CPF deve ter no máximo 11 dígitos';
    END IF;
  END IF;

  UPDATE people.colaboradores
  SET
    nome = CASE WHEN p_update_data ? 'nome' THEN (p_update_data->>'nome')::VARCHAR ELSE nome END,
    email = CASE WHEN p_update_data ? 'email' THEN (p_update_data->>'email')::VARCHAR ELSE email END,
    cpf = CASE WHEN p_update_data ? 'cpf' AND v_clean_cpf IS NOT NULL THEN v_clean_cpf ELSE cpf END,
    data_nascimento = CASE WHEN p_update_data ? 'data_nascimento' AND p_update_data->>'data_nascimento' IS NOT NULL THEN (p_update_data->>'data_nascimento')::DATE ELSE data_nascimento END,
    data_entrada = CASE WHEN p_update_data ? 'data_entrada' THEN CASE WHEN COALESCE(p_update_data->>'data_entrada', '') = '' THEN NULL ELSE (p_update_data->>'data_entrada')::DATE END ELSE data_entrada END,
    data_saida = CASE WHEN p_update_data ? 'data_saida' THEN CASE WHEN COALESCE(p_update_data->>'data_saida', '') = '' THEN NULL ELSE (p_update_data->>'data_saida')::DATE END ELSE data_saida END,
    categoria = CASE WHEN p_update_data ? 'categoria' AND p_update_data->>'categoria' IS NOT NULL THEN (p_update_data->>'categoria')::people.colaborador_categoria ELSE categoria END,
    carreira = CASE WHEN p_update_data ? 'carreira' THEN NULLIF(p_update_data->>'carreira','')::VARCHAR ELSE carreira END,
    eh_coordenador = CASE WHEN p_update_data ? 'eh_coordenador' THEN (p_update_data->>'eh_coordenador')::BOOLEAN ELSE eh_coordenador END,
    oab = CASE WHEN p_update_data ? 'oab' THEN CASE WHEN p_update_data->>'oab' = '' THEN NULL ELSE (p_update_data->>'oab')::VARCHAR END ELSE oab END,
    whatsapp = CASE WHEN p_update_data ? 'whatsapp' THEN CASE WHEN p_update_data->>'whatsapp' = '' THEN NULL ELSE (p_update_data->>'whatsapp')::VARCHAR END ELSE whatsapp END,
    cep = CASE WHEN p_update_data ? 'cep' THEN CASE WHEN p_update_data->>'cep' = '' THEN NULL ELSE (p_update_data->>'cep')::VARCHAR END ELSE cep END,
    rua = CASE WHEN p_update_data ? 'rua' THEN CASE WHEN p_update_data->>'rua' = '' THEN NULL ELSE (p_update_data->>'rua')::VARCHAR END ELSE rua END,
    numero = CASE WHEN p_update_data ? 'numero' THEN CASE WHEN p_update_data->>'numero' = '' THEN NULL ELSE (p_update_data->>'numero')::VARCHAR END ELSE numero END,
    complemento = CASE WHEN p_update_data ? 'complemento' THEN CASE WHEN p_update_data->>'complemento' = '' THEN NULL ELSE (p_update_data->>'complemento')::VARCHAR END ELSE complemento END,
    cidade = CASE WHEN p_update_data ? 'cidade' THEN CASE WHEN p_update_data->>'cidade' = '' THEN NULL ELSE (p_update_data->>'cidade')::VARCHAR END ELSE cidade END,
    estado = CASE WHEN p_update_data ? 'estado' THEN CASE WHEN p_update_data->>'estado' = '' THEN NULL ELSE (p_update_data->>'estado')::VARCHAR END ELSE estado END,
    cargo_id = CASE WHEN p_update_data ? 'cargo_id' AND p_update_data->>'cargo_id' IS NOT NULL THEN (p_update_data->>'cargo_id')::UUID ELSE cargo_id END,
    area_id = CASE WHEN p_update_data ? 'area_id' AND p_update_data->>'area_id' IS NOT NULL AND p_update_data->>'area_id' != '' THEN (p_update_data->>'area_id')::UUID ELSE area_id END,
    adicional = CASE WHEN p_update_data ? 'adicional' AND p_update_data->>'adicional' IS NOT NULL AND p_update_data->>'adicional' != '' THEN (p_update_data->>'adicional')::people.colaborador_adicional ELSE adicional END,
    percentual_adicional = CASE WHEN p_update_data ? 'percentual_adicional' AND p_update_data->>'percentual_adicional' IS NOT NULL THEN (p_update_data->>'percentual_adicional')::DECIMAL(5,2) ELSE percentual_adicional END,
    salario = CASE WHEN p_update_data ? 'salario' AND p_update_data->>'salario' IS NOT NULL THEN (p_update_data->>'salario')::DECIMAL(10,2) ELSE salario END,
    banco = CASE WHEN p_update_data ? 'banco' THEN CASE WHEN p_update_data->>'banco' = '' THEN NULL ELSE (p_update_data->>'banco')::VARCHAR END ELSE banco END,
    agencia = CASE WHEN p_update_data ? 'agencia' THEN CASE WHEN p_update_data->>'agencia' = '' THEN NULL ELSE (p_update_data->>'agencia')::VARCHAR END ELSE agencia END,
    conta_com_digito = CASE WHEN p_update_data ? 'conta_com_digito' THEN CASE WHEN p_update_data->>'conta_com_digito' = '' THEN NULL ELSE (p_update_data->>'conta_com_digito')::VARCHAR END ELSE conta_com_digito END,
    chave_pix = CASE WHEN p_update_data ? 'chave_pix' THEN CASE WHEN p_update_data->>'chave_pix' = '' THEN NULL ELSE (p_update_data->>'chave_pix')::VARCHAR END ELSE chave_pix END,
    conta_contabil = CASE WHEN p_update_data ? 'conta_contabil' THEN NULLIF(p_update_data->>'conta_contabil', '') ELSE conta_contabil END,
    skills = CASE WHEN p_update_data ? 'skills' THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_update_data->'skills')), ARRAY[]::text[]) ELSE skills END,
    ativo = CASE WHEN p_update_data ? 'ativo' THEN (p_update_data->>'ativo')::BOOLEAN ELSE ativo END,
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_colaborador_id
    AND tenant_id = v_tenant_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RAISE EXCEPTION 'Failed to update colaborador or colaborador not found after check';
  END IF;

  SELECT public.get_colaborador(p_user_id, p_colaborador_id) INTO v_colaborador;

  RETURN v_colaborador;
END;
$function$
;

NOTIFY pgrst, 'reload schema';
