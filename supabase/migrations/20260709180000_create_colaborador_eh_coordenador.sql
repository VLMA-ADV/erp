-- Completar: criar colaborador já podendo marcá-lo como coordenador.
-- create_colaborador passa a inserir eh_coordenador (default false).

CREATE OR REPLACE FUNCTION public.create_colaborador(p_user_id uuid, p_colaborador_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_new_user_id UUID;
  v_colaborador_id UUID;
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

  v_new_user_id := (p_colaborador_data->>'user_id')::UUID;
  v_colaborador_id := gen_random_uuid();

  INSERT INTO people.colaboradores (
    id,
    tenant_id,
    user_id,
    nome,
    email,
    cpf,
    data_nascimento,
    data_entrada,
    data_saida,
    categoria,
    carreira,
    eh_coordenador,
    oab,
    whatsapp,
    cep,
    rua,
    numero,
    complemento,
    cidade,
    estado,
    cargo_id,
    area_id,
    adicional,
    percentual_adicional,
    salario,
    banco,
    agencia,
    conta_com_digito,
    chave_pix,
    conta_contabil,
    skills,
    created_by
  ) VALUES (
    v_colaborador_id,
    v_tenant_id,
    v_new_user_id,
    (p_colaborador_data->>'nome')::VARCHAR,
    (p_colaborador_data->>'email')::VARCHAR,
    (p_colaborador_data->>'cpf')::VARCHAR,
    CASE WHEN p_colaborador_data->>'data_nascimento' IS NOT NULL
      THEN (p_colaborador_data->>'data_nascimento')::DATE
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'data_entrada' IS NOT NULL AND p_colaborador_data->>'data_entrada' <> ''
      THEN (p_colaborador_data->>'data_entrada')::DATE
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'data_saida' IS NOT NULL AND p_colaborador_data->>'data_saida' <> ''
      THEN (p_colaborador_data->>'data_saida')::DATE
      ELSE NULL
    END,
    (p_colaborador_data->>'categoria')::people.colaborador_categoria,
    NULLIF(p_colaborador_data->>'carreira','')::VARCHAR,
    COALESCE((p_colaborador_data->>'eh_coordenador')::BOOLEAN, false),
    CASE WHEN p_colaborador_data->>'oab' IS NOT NULL AND p_colaborador_data->>'oab' != ''
      THEN (p_colaborador_data->>'oab')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'whatsapp' IS NOT NULL AND p_colaborador_data->>'whatsapp' != ''
      THEN (p_colaborador_data->>'whatsapp')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'cep' IS NOT NULL AND p_colaborador_data->>'cep' != ''
      THEN (p_colaborador_data->>'cep')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'rua' IS NOT NULL AND p_colaborador_data->>'rua' != ''
      THEN (p_colaborador_data->>'rua')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'numero' IS NOT NULL AND p_colaborador_data->>'numero' != ''
      THEN (p_colaborador_data->>'numero')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'complemento' IS NOT NULL AND p_colaborador_data->>'complemento' != ''
      THEN (p_colaborador_data->>'complemento')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'cidade' IS NOT NULL AND p_colaborador_data->>'cidade' != ''
      THEN (p_colaborador_data->>'cidade')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'estado' IS NOT NULL AND p_colaborador_data->>'estado' != ''
      THEN (p_colaborador_data->>'estado')::VARCHAR
      ELSE NULL
    END,
    (p_colaborador_data->>'cargo_id')::UUID,
    CASE WHEN p_colaborador_data->>'area_id' IS NOT NULL AND p_colaborador_data->>'area_id' != ''
      THEN (p_colaborador_data->>'area_id')::UUID
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'adicional' IS NOT NULL AND p_colaborador_data->>'adicional' != ''
      THEN (p_colaborador_data->>'adicional')::people.colaborador_adicional
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'percentual_adicional' IS NOT NULL
      THEN (p_colaborador_data->>'percentual_adicional')::DECIMAL(5,2)
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'salario' IS NOT NULL
      THEN (p_colaborador_data->>'salario')::DECIMAL(10,2)
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'banco' IS NOT NULL AND p_colaborador_data->>'banco' != ''
      THEN (p_colaborador_data->>'banco')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'agencia' IS NOT NULL AND p_colaborador_data->>'agencia' != ''
      THEN (p_colaborador_data->>'agencia')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'conta_com_digito' IS NOT NULL AND p_colaborador_data->>'conta_com_digito' != ''
      THEN (p_colaborador_data->>'conta_com_digito')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'chave_pix' IS NOT NULL AND p_colaborador_data->>'chave_pix' != ''
      THEN (p_colaborador_data->>'chave_pix')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data ? 'conta_contabil'
      THEN NULLIF(p_colaborador_data->>'conta_contabil', '')
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data ? 'skills'
      THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_colaborador_data->'skills')), ARRAY[]::text[])
      ELSE ARRAY[]::text[]
    END,
    p_user_id
  )
  RETURNING id INTO v_colaborador_id;

  SELECT public.get_colaborador(p_user_id, v_colaborador_id) INTO v_result;

  RETURN v_result;
END;
$function$
;

NOTIFY pgrst, 'reload schema';
