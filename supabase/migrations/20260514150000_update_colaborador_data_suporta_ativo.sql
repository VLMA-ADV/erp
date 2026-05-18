-- Daily 2026-05-14 (Filipe 16:49): "eu não consigo apagar pessoas".
--
-- Causa raiz: edge `toggle-colaborador-status` envia
-- `{ ativo: !current }` para o RPC `public.update_colaborador_data`,
-- mas o RPC não tem CASE para `ativo` — o campo é silenciosamente
-- ignorado. O UPDATE roda, retorna sucesso, mas `ativo` continua
-- igual. Filipe vê 200 OK na UI e nenhum efeito no toggle.
--
-- Fix: adicionar CASE para `ativo` (BOOLEAN) no UPDATE do RPC.
-- Demais campos preservados sem mudança.

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
    nome = CASE
      WHEN p_update_data ? 'nome' THEN (p_update_data->>'nome')::VARCHAR
      ELSE nome
    END,
    email = CASE
      WHEN p_update_data ? 'email' THEN (p_update_data->>'email')::VARCHAR
      ELSE email
    END,
    cpf = CASE
      WHEN p_update_data ? 'cpf' AND v_clean_cpf IS NOT NULL THEN v_clean_cpf
      ELSE cpf
    END,
    data_nascimento = CASE
      WHEN p_update_data ? 'data_nascimento' AND p_update_data->>'data_nascimento' IS NOT NULL
      THEN (p_update_data->>'data_nascimento')::DATE
      ELSE data_nascimento
    END,
    data_entrada = CASE
      WHEN p_update_data ? 'data_entrada' THEN
        CASE
          WHEN COALESCE(p_update_data->>'data_entrada', '') = '' THEN NULL
          ELSE (p_update_data->>'data_entrada')::DATE
        END
      ELSE data_entrada
    END,
    data_saida = CASE
      WHEN p_update_data ? 'data_saida' THEN
        CASE
          WHEN COALESCE(p_update_data->>'data_saida', '') = '' THEN NULL
          ELSE (p_update_data->>'data_saida')::DATE
        END
      ELSE data_saida
    END,
    categoria = CASE
      WHEN p_update_data ? 'categoria' AND p_update_data->>'categoria' IS NOT NULL
      THEN (p_update_data->>'categoria')::people.colaborador_categoria
      ELSE categoria
    END,
    oab = CASE
      WHEN p_update_data ? 'oab' THEN
        CASE WHEN p_update_data->>'oab' = '' THEN NULL ELSE (p_update_data->>'oab')::VARCHAR END
      ELSE oab
    END,
    whatsapp = CASE
      WHEN p_update_data ? 'whatsapp' THEN
        CASE WHEN p_update_data->>'whatsapp' = '' THEN NULL ELSE (p_update_data->>'whatsapp')::VARCHAR END
      ELSE whatsapp
    END,
    cep = CASE
      WHEN p_update_data ? 'cep' THEN
        CASE WHEN p_update_data->>'cep' = '' THEN NULL ELSE (p_update_data->>'cep')::VARCHAR END
      ELSE cep
    END,
    rua = CASE
      WHEN p_update_data ? 'rua' THEN
        CASE WHEN p_update_data->>'rua' = '' THEN NULL ELSE (p_update_data->>'rua')::VARCHAR END
      ELSE rua
    END,
    numero = CASE
      WHEN p_update_data ? 'numero' THEN
        CASE WHEN p_update_data->>'numero' = '' THEN NULL ELSE (p_update_data->>'numero')::VARCHAR END
      ELSE numero
    END,
    complemento = CASE
      WHEN p_update_data ? 'complemento' THEN
        CASE WHEN p_update_data->>'complemento' = '' THEN NULL ELSE (p_update_data->>'complemento')::VARCHAR END
      ELSE complemento
    END,
    cidade = CASE
      WHEN p_update_data ? 'cidade' THEN
        CASE WHEN p_update_data->>'cidade' = '' THEN NULL ELSE (p_update_data->>'cidade')::VARCHAR END
      ELSE cidade
    END,
    estado = CASE
      WHEN p_update_data ? 'estado' THEN
        CASE WHEN p_update_data->>'estado' = '' THEN NULL ELSE (p_update_data->>'estado')::VARCHAR END
      ELSE estado
    END,
    cargo_id = CASE
      WHEN p_update_data ? 'cargo_id' AND p_update_data->>'cargo_id' IS NOT NULL
      THEN (p_update_data->>'cargo_id')::UUID
      ELSE cargo_id
    END,
    area_id = CASE
      WHEN p_update_data ? 'area_id' AND p_update_data->>'area_id' IS NOT NULL AND p_update_data->>'area_id' != ''
      THEN (p_update_data->>'area_id')::UUID
      ELSE area_id
    END,
    adicional = CASE
      WHEN p_update_data ? 'adicional' AND p_update_data->>'adicional' IS NOT NULL AND p_update_data->>'adicional' != ''
      THEN (p_update_data->>'adicional')::people.colaborador_adicional
      ELSE adicional
    END,
    percentual_adicional = CASE
      WHEN p_update_data ? 'percentual_adicional' AND p_update_data->>'percentual_adicional' IS NOT NULL
      THEN (p_update_data->>'percentual_adicional')::DECIMAL(5,2)
      ELSE percentual_adicional
    END,
    salario = CASE
      WHEN p_update_data ? 'salario' AND p_update_data->>'salario' IS NOT NULL
      THEN (p_update_data->>'salario')::DECIMAL(10,2)
      ELSE salario
    END,
    banco = CASE
      WHEN p_update_data ? 'banco' THEN
        CASE WHEN p_update_data->>'banco' = '' THEN NULL ELSE (p_update_data->>'banco')::VARCHAR END
      ELSE banco
    END,
    agencia = CASE
      WHEN p_update_data ? 'agencia' THEN
        CASE WHEN p_update_data->>'agencia' = '' THEN NULL ELSE (p_update_data->>'agencia')::VARCHAR END
      ELSE agencia
    END,
    conta_com_digito = CASE
      WHEN p_update_data ? 'conta_com_digito' THEN
        CASE WHEN p_update_data->>'conta_com_digito' = '' THEN NULL ELSE (p_update_data->>'conta_com_digito')::VARCHAR END
      ELSE conta_com_digito
    END,
    chave_pix = CASE
      WHEN p_update_data ? 'chave_pix' THEN
        CASE WHEN p_update_data->>'chave_pix' = '' THEN NULL ELSE (p_update_data->>'chave_pix')::VARCHAR END
      ELSE chave_pix
    END,
    conta_contabil = CASE
      WHEN p_update_data ? 'conta_contabil' THEN NULLIF(p_update_data->>'conta_contabil', '')
      ELSE conta_contabil
    END,
    skills = CASE
      WHEN p_update_data ? 'skills'
      THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_update_data->'skills')), ARRAY[]::text[])
      ELSE skills
    END,
    ativo = CASE
      WHEN p_update_data ? 'ativo' THEN (p_update_data->>'ativo')::BOOLEAN
      ELSE ativo
    END,
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
$function$;
