CREATE OR REPLACE FUNCTION public.import_clientes_csv_lote(
  p_user_id UUID,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_tenant_id UUID;
  v_item JSONB;
  v_nome TEXT;
  v_cnpj TEXT;
  v_duplicate_rows JSONB := '[]'::jsonb;
  v_error_rows JSONB := '[]'::jsonb;
  v_unique_items JSONB := '[]'::jsonb;
  v_seen_cnpjs TEXT[] := ARRAY[]::TEXT[];
  v_existing_cnpjs TEXT[] := ARRAY[]::TEXT[];
  v_created_count INTEGER := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum cliente enviado para importação';
  END IF;

  SELECT tenant_id
    INTO v_tenant_id
  FROM get_user_tenant(p_user_id)
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant vinculado';
  END IF;

  SELECT COALESCE(array_agg(regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g')), ARRAY[]::TEXT[])
    INTO v_existing_cnpjs
  FROM crm.clientes
  WHERE tenant_id = v_tenant_id
    AND cnpj IS NOT NULL;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    v_nome := btrim(COALESCE(v_item->>'nome', ''));
    v_cnpj := regexp_replace(COALESCE(v_item->>'cnpj', ''), '\D', '', 'g');

    IF v_nome = '' OR v_cnpj = '' THEN
      v_error_rows := v_error_rows || jsonb_build_array(jsonb_build_object(
        'nome', v_nome,
        'cnpj', v_cnpj,
        'erro', 'Nome e CNPJ são obrigatórios'
      ));
      CONTINUE;
    END IF;

    IF v_cnpj = ANY(v_existing_cnpjs) OR v_cnpj = ANY(v_seen_cnpjs) THEN
      v_duplicate_rows := v_duplicate_rows || jsonb_build_array(jsonb_build_object(
        'nome', v_nome,
        'cnpj', v_cnpj
      ));
      CONTINUE;
    END IF;

    v_seen_cnpjs := array_append(v_seen_cnpjs, v_cnpj);
    v_unique_items := v_unique_items || jsonb_build_array(jsonb_build_object(
      'nome', v_nome,
      'cnpj', v_cnpj
    ));
  END LOOP;

  IF jsonb_array_length(v_error_rows) > 0 THEN
    RETURN jsonb_build_object(
      'criados', 0,
      'duplicatas', jsonb_array_length(v_duplicate_rows),
      'erros', v_error_rows
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_unique_items)
  LOOP
    PERFORM create_cliente(
      p_user_id := p_user_id,
      p_nome := v_item->>'nome',
      p_cliente_estrangeiro := FALSE,
      p_cnpj := v_item->>'cnpj',
      p_tipo := 'pessoa_juridica',
      p_rua := NULL,
      p_numero := NULL,
      p_complemento := NULL,
      p_cidade := NULL,
      p_estado := NULL,
      p_cep := NULL,
      p_regime_fiscal := NULL,
      p_grupo_economico_id := NULL,
      p_observacoes := NULL,
      p_segmento_ids := NULL,
      p_resp_int_nome := NULL,
      p_resp_int_email := NULL,
      p_resp_int_whatsapp := NULL,
      p_resp_int_data_nascimento := NULL,
      p_resp_fin_nome := NULL,
      p_resp_fin_email := NULL,
      p_resp_fin_whatsapp := NULL
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'criados', v_created_count,
    'duplicatas', jsonb_array_length(v_duplicate_rows),
    'erros', '[]'::jsonb
  );
END;
$$;
