-- Fornecedores: o CRUD via PostgREST (.schema('operations')) nunca funcionou —
-- o schema não está exposto no PostgREST em execução e a tabela nem tinha as
-- colunas de responsável/bancárias que o form envia. Converte tudo para RPCs
-- (padrão do projeto) e completa a tabela. Também move o "postergar" do
-- timesheet (periodo_faturamento) para RPC.

ALTER TABLE operations.fornecedores
  ADD COLUMN IF NOT EXISTS resp_nome varchar,
  ADD COLUMN IF NOT EXISTS resp_email varchar,
  ADD COLUMN IF NOT EXISTS resp_cpf varchar,
  ADD COLUMN IF NOT EXISTS resp_telefone varchar,
  ADD COLUMN IF NOT EXISTS resp_whatsapp varchar,
  ADD COLUMN IF NOT EXISTS resp_cep varchar,
  ADD COLUMN IF NOT EXISTS resp_rua varchar,
  ADD COLUMN IF NOT EXISTS resp_numero varchar,
  ADD COLUMN IF NOT EXISTS resp_complemento varchar,
  ADD COLUMN IF NOT EXISTS resp_cidade varchar,
  ADD COLUMN IF NOT EXISTS resp_estado varchar,
  ADD COLUMN IF NOT EXISTS banco varchar,
  ADD COLUMN IF NOT EXISTS conta_com_digito varchar,
  ADD COLUMN IF NOT EXISTS agencia varchar,
  ADD COLUMN IF NOT EXISTS chave_pix varchar;

-- Campos de texto editáveis pelo form ('' vira NULL).
CREATE OR REPLACE FUNCTION public._fornecedor_campos()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['nome_fornecedor','cpf_cnpj','conta_contabil','cep','rua','numero','complemento','cidade','estado',
               'resp_nome','resp_email','resp_cpf','resp_telefone','resp_whatsapp','resp_cep','resp_rua','resp_numero',
               'resp_complemento','resp_cidade','resp_estado','banco','conta_com_digito','agencia','chave_pix'];
$$;

CREATE OR REPLACE FUNCTION public.fornecedor_criar(p_user_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid; v_id uuid; v_campo text; v_cols text := ''; v_vals text := '';
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF COALESCE(trim(p_payload->>'nome_fornecedor'), '') = '' THEN RAISE EXCEPTION 'Nome é obrigatório'; END IF;

  INSERT INTO operations.fornecedores (
    tenant_id, nome_fornecedor, cpf_cnpj, tipo_documento, conta_contabil,
    servico_recorrente, valor_recorrente, categoria_prestador_parceiro_id,
    cep, rua, numero, complemento, cidade, estado,
    resp_nome, resp_email, resp_cpf, resp_telefone, resp_whatsapp,
    resp_cep, resp_rua, resp_numero, resp_complemento, resp_cidade, resp_estado,
    banco, conta_com_digito, agencia, chave_pix,
    ativo, created_by, updated_by
  ) VALUES (
    v_tenant,
    trim(p_payload->>'nome_fornecedor'),
    NULLIF(p_payload->>'cpf_cnpj',''),
    COALESCE(NULLIF(p_payload->>'tipo_documento','') , 'cnpj')::operations.tipo_documento,
    NULLIF(p_payload->>'conta_contabil',''),
    COALESCE((p_payload->>'servico_recorrente')::boolean, false),
    NULLIF(p_payload->>'valor_recorrente','')::numeric,
    NULLIF(p_payload->>'categoria_prestador_parceiro_id','')::uuid,
    NULLIF(p_payload->>'cep',''), NULLIF(p_payload->>'rua',''), NULLIF(p_payload->>'numero',''),
    NULLIF(p_payload->>'complemento',''), NULLIF(p_payload->>'cidade',''), NULLIF(p_payload->>'estado',''),
    NULLIF(p_payload->>'resp_nome',''), NULLIF(p_payload->>'resp_email',''), NULLIF(p_payload->>'resp_cpf',''),
    NULLIF(p_payload->>'resp_telefone',''), NULLIF(p_payload->>'resp_whatsapp',''),
    NULLIF(p_payload->>'resp_cep',''), NULLIF(p_payload->>'resp_rua',''), NULLIF(p_payload->>'resp_numero',''),
    NULLIF(p_payload->>'resp_complemento',''), NULLIF(p_payload->>'resp_cidade',''), NULLIF(p_payload->>'resp_estado',''),
    NULLIF(p_payload->>'banco',''), NULLIF(p_payload->>'conta_com_digito',''), NULLIF(p_payload->>'agencia',''),
    NULLIF(p_payload->>'chave_pix',''),
    true, p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fornecedor_atualizar(p_user_id uuid, p_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid; v_campo text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM operations.fornecedores f WHERE f.id = p_id AND f.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não encontrado';
  END IF;

  FOREACH v_campo IN ARRAY public._fornecedor_campos() LOOP
    IF p_payload ? v_campo THEN
      EXECUTE format('UPDATE operations.fornecedores SET %I = NULLIF($1->>%L, '''') WHERE id = $2', v_campo, v_campo)
      USING p_payload, p_id;
    END IF;
  END LOOP;
  IF p_payload ? 'tipo_documento' AND NULLIF(p_payload->>'tipo_documento','') IS NOT NULL THEN
    UPDATE operations.fornecedores SET tipo_documento = (p_payload->>'tipo_documento')::operations.tipo_documento WHERE id = p_id;
  END IF;
  IF p_payload ? 'servico_recorrente' THEN
    UPDATE operations.fornecedores SET servico_recorrente = COALESCE((p_payload->>'servico_recorrente')::boolean, false) WHERE id = p_id;
  END IF;
  IF p_payload ? 'valor_recorrente' THEN
    UPDATE operations.fornecedores SET valor_recorrente = NULLIF(p_payload->>'valor_recorrente','')::numeric WHERE id = p_id;
  END IF;
  IF p_payload ? 'categoria_prestador_parceiro_id' THEN
    UPDATE operations.fornecedores SET categoria_prestador_parceiro_id = NULLIF(p_payload->>'categoria_prestador_parceiro_id','')::uuid WHERE id = p_id;
  END IF;

  UPDATE operations.fornecedores SET updated_at = now(), updated_by = p_user_id WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fornecedor_obter(p_user_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid; v_row jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT to_jsonb(f.*) INTO v_row FROM operations.fornecedores f WHERE f.id = p_id AND f.tenant_id = v_tenant;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Fornecedor não encontrado'; END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fornecedores_listar(p_user_id uuid, p_search text DEFAULT NULL, p_somente_ativos boolean DEFAULT false, p_page int DEFAULT 1, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid; v_total bigint; v_items jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT count(*) INTO v_total FROM operations.fornecedores f
  WHERE f.tenant_id = v_tenant
    AND (NOT p_somente_ativos OR f.ativo)
    AND (p_search IS NULL OR f.nome_fornecedor ILIKE '%'||p_search||'%' OR f.cpf_cnpj ILIKE '%'||p_search||'%');

  SELECT COALESCE(jsonb_agg(to_jsonb(x.*)), '[]'::jsonb) INTO v_items FROM (
    SELECT f.* FROM operations.fornecedores f
    WHERE f.tenant_id = v_tenant
      AND (NOT p_somente_ativos OR f.ativo)
      AND (p_search IS NULL OR f.nome_fornecedor ILIKE '%'||p_search||'%' OR f.cpf_cnpj ILIKE '%'||p_search||'%')
    ORDER BY f.nome_fornecedor
    OFFSET (GREATEST(p_page,1)-1)*p_limit LIMIT p_limit
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fornecedor_toggle_status(p_user_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid; v_novo boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  UPDATE operations.fornecedores f SET ativo = NOT f.ativo, updated_at = now(), updated_by = p_user_id
  WHERE f.id = p_id AND f.tenant_id = v_tenant
  RETURNING f.ativo INTO v_novo;
  IF v_novo IS NULL THEN RAISE EXCEPTION 'Fornecedor não encontrado'; END IF;
  RETURN jsonb_build_object('id', p_id, 'ativo', v_novo);
END;
$function$;

-- Postergar (etapa 1): grava o novo período de faturamento do timesheet.
CREATE OR REPLACE FUNCTION public.set_timesheet_periodo_faturamento(p_user_id uuid, p_id uuid, p_periodo date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  UPDATE operations.timesheets t SET periodo_faturamento = p_periodo, updated_at = now(), updated_by = p_user_id
  WHERE t.id = p_id AND t.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Timesheet não encontrado'; END IF;
  RETURN jsonb_build_object('id', p_id, 'periodo_faturamento', p_periodo);
END;
$function$;
