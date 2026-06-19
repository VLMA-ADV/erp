-- Múltiplos arquivos por despesa.
-- O arquivo "principal" continua nas colunas legadas de operations.despesas
-- (mantém get_despesas, composição da fatura e nota de despesa funcionando e
-- garante o "pelo menos 1 obrigatório"). Arquivos ADICIONAIS ficam em
-- operations.despesa_anexos. Todo acesso é via RPC SECURITY DEFINER porque o
-- schema operations não é exposto ao PostgREST.

CREATE TABLE IF NOT EXISTS operations.despesa_anexos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  despesa_id    uuid NOT NULL REFERENCES operations.despesas(id) ON DELETE CASCADE,
  arquivo       bytea NOT NULL,
  arquivo_nome  varchar NOT NULL,
  mime_type     varchar,
  tamanho_bytes bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_despesa_anexos_despesa ON operations.despesa_anexos (despesa_id);

ALTER TABLE operations.despesa_anexos ENABLE ROW LEVEL SECURITY;

-- ── create_despesa: principal (inalterado) + anexos_extra (array) ────────────
CREATE OR REPLACE FUNCTION public.create_despesa(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_contrato_id uuid;
  v_caso_id uuid;
  v_cliente_id uuid;
  v_valor numeric(14,2);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NULLIF(p_payload->>'contrato_id', '') IS NULL OR NULLIF(p_payload->>'caso_id', '') IS NULL THEN
    RAISE EXCEPTION 'Contrato e caso são obrigatórios';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'categoria'), ''), '') = '' THEN
    RAISE EXCEPTION 'Categoria é obrigatória';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'arquivo_nome'), ''), '') = '' THEN
    RAISE EXCEPTION 'Arquivo é obrigatório';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') = '' THEN
    RAISE EXCEPTION 'Arquivo em base64 é obrigatório';
  END IF;

  v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'Valor da despesa é obrigatório e deve ser maior que zero';
  END IF;

  v_contrato_id := (p_payload->>'contrato_id')::uuid;
  v_caso_id := (p_payload->>'caso_id')::uuid;

  SELECT c.cliente_id INTO v_cliente_id
  FROM contracts.contratos c
  WHERE c.id = v_contrato_id AND c.tenant_id = v_tenant_id AND c.status = 'ativo';

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado ou encerrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = v_caso_id AND cs.contrato_id = v_contrato_id
      AND cs.tenant_id = v_tenant_id AND cs.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado/ativo para o contrato informado';
  END IF;

  INSERT INTO operations.despesas (
    tenant_id, cliente_id, contrato_id, caso_id, data_lancamento, categoria,
    valor, descricao, status, arquivo_nome, mime_type, tamanho_bytes, arquivo,
    created_by, updated_by
  ) VALUES (
    v_tenant_id, v_cliente_id, v_contrato_id, v_caso_id,
    COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, now()::date),
    trim(p_payload->>'categoria'),
    v_valor,
    COALESCE(p_payload->>'descricao', ''),
    'em_lancamento',
    trim(p_payload->>'arquivo_nome'),
    NULLIF(p_payload->>'mime_type', ''),
    NULLIF(p_payload->>'tamanho_bytes', '')::bigint,
    decode(p_payload->>'arquivo_base64', 'base64'),
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  -- Anexos adicionais (opcionais)
  IF jsonb_typeof(p_payload->'anexos_extra') = 'array' THEN
    INSERT INTO operations.despesa_anexos (tenant_id, despesa_id, arquivo, arquivo_nome, mime_type, tamanho_bytes)
    SELECT v_tenant_id, v_id,
      decode(e->>'arquivo_base64', 'base64'),
      trim(e->>'arquivo_nome'),
      NULLIF(e->>'mime_type', ''),
      NULLIF(e->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_payload->'anexos_extra') e
    WHERE COALESCE(NULLIF(trim(e->>'arquivo_base64'), ''), '') <> ''
      AND COALESCE(NULLIF(trim(e->>'arquivo_nome'), ''), '') <> '';
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── update_despesa: + anexos_remove (ids) e anexos_extra_add (array) ─────────
CREATE OR REPLACE FUNCTION public.update_despesa(p_user_id uuid, p_despesa_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_current operations.despesas%ROWTYPE;
  v_is_admin boolean := false;
  v_valor numeric(14,2);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT * INTO v_current
  FROM operations.despesas d
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  IF v_current.status = 'aprovado' THEN
    RAISE EXCEPTION 'Despesa aprovada não pode ser alterada';
  END IF;

  v_is_admin := COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  IF v_current.status <> 'em_lancamento'
     AND v_current.created_by <> p_user_id
     AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Despesa só pode ser editada em lançamento pelo criador';
  END IF;

  IF p_payload ? 'valor' THEN
    v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
    IF v_valor <= 0 THEN
      RAISE EXCEPTION 'Valor da despesa é obrigatório e deve ser maior que zero';
    END IF;
  END IF;

  UPDATE operations.despesas d
  SET
    cliente_id = COALESCE((
      SELECT c.cliente_id FROM contracts.contratos c
      WHERE c.id = d.contrato_id AND c.tenant_id = d.tenant_id LIMIT 1
    ), d.cliente_id),
    data_lancamento = COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, d.data_lancamento),
    categoria = COALESCE(NULLIF(trim(p_payload->>'categoria'), ''), d.categoria),
    valor = CASE WHEN p_payload ? 'valor' THEN v_valor ELSE d.valor END,
    descricao = CASE WHEN p_payload ? 'descricao' THEN COALESCE(p_payload->>'descricao', '') ELSE d.descricao END,
    status = CASE
      WHEN p_payload ? 'status' AND (p_payload->>'status') IN ('em_lancamento', 'revisao', 'aprovado', 'cancelado')
        THEN p_payload->>'status'
      ELSE d.status END,
    arquivo_nome = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN COALESCE(NULLIF(trim(p_payload->>'arquivo_nome'), ''), d.arquivo_nome)
      ELSE d.arquivo_nome END,
    mime_type = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'mime_type', '')
      ELSE d.mime_type END,
    tamanho_bytes = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'tamanho_bytes', '')::bigint
      ELSE d.tamanho_bytes END,
    arquivo = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN decode(p_payload->>'arquivo_base64', 'base64')
      ELSE d.arquivo END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

  -- Remover anexos adicionais selecionados
  IF jsonb_typeof(p_payload->'anexos_remove') = 'array' THEN
    DELETE FROM operations.despesa_anexos a
    WHERE a.despesa_id = p_despesa_id AND a.tenant_id = v_tenant_id
      AND a.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(p_payload->'anexos_remove') e);
  END IF;

  -- Adicionar novos anexos
  IF jsonb_typeof(p_payload->'anexos_extra_add') = 'array' THEN
    INSERT INTO operations.despesa_anexos (tenant_id, despesa_id, arquivo, arquivo_nome, mime_type, tamanho_bytes)
    SELECT v_tenant_id, p_despesa_id,
      decode(e->>'arquivo_base64', 'base64'),
      trim(e->>'arquivo_nome'),
      NULLIF(e->>'mime_type', ''),
      NULLIF(e->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_payload->'anexos_extra_add') e
    WHERE COALESCE(NULLIF(trim(e->>'arquivo_base64'), ''), '') <> ''
      AND COALESCE(NULLIF(trim(e->>'arquivo_nome'), ''), '') <> '';
  END IF;

  RETURN jsonb_build_object('id', p_despesa_id);
END;
$function$;

-- ── get_despesas: + anexos[] (principal + adicionais, sem o binário) ─────────
CREATE OR REPLACE FUNCTION public.get_despesas(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
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
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'contrato_id', d.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_numero_sequencial', ct.numero_sequencial,
        'contrato_nome', ct.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'cliente_id', ct.cliente_id,
        'cliente_nome', cli.nome,
        'data_lancamento', d.data_lancamento,
        'categoria', d.categoria,
        'valor', COALESCE(d.valor, 0),
        'descricao', d.descricao,
        'status', d.status,
        'arquivo_nome', d.arquivo_nome,
        'mime_type', d.mime_type,
        'tamanho_bytes', d.tamanho_bytes,
        'anexos', (
          SELECT jsonb_agg(item ORDER BY ord)
          FROM (
            SELECT 0 AS ord, jsonb_build_object(
              'id', d.id, 'kind', 'primario',
              'arquivo_nome', d.arquivo_nome, 'mime_type', d.mime_type, 'tamanho_bytes', d.tamanho_bytes
            ) AS item
            WHERE d.arquivo_nome IS NOT NULL
            UNION ALL
            SELECT 1 AS ord, jsonb_build_object(
              'id', a.id, 'kind', 'extra',
              'arquivo_nome', a.arquivo_nome, 'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes
            )
            FROM operations.despesa_anexos a
            WHERE a.despesa_id = d.id
          ) s
        ),
        'created_by', d.created_by,
        'created_by_nome', cb.nome,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      )
      ORDER BY d.data_lancamento DESC, d.created_at DESC
    )
    FROM operations.despesas d
    JOIN contracts.contratos ct ON ct.id = d.contrato_id
    JOIN contracts.casos cs ON cs.id = d.caso_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = d.created_by AND cb.tenant_id = d.tenant_id
    WHERE d.tenant_id = v_tenant_id
      AND (NULLIF(p_filters->>'contrato_id', '') IS NULL OR d.contrato_id = (p_filters->>'contrato_id')::uuid)
      AND (NULLIF(p_filters->>'caso_id', '') IS NULL OR d.caso_id = (p_filters->>'caso_id')::uuid)
      AND (NULLIF(p_filters->>'status', '') IS NULL OR d.status = p_filters->>'status')
      AND (NULLIF(p_filters->>'categoria', '') IS NULL OR lower(d.categoria) = lower(p_filters->>'categoria'))
      AND (NULLIF(p_filters->>'data_inicio', '') IS NULL OR d.data_lancamento >= (p_filters->>'data_inicio')::date)
      AND (NULLIF(p_filters->>'data_fim', '') IS NULL OR d.data_lancamento <= (p_filters->>'data_fim')::date)
  ), '[]'::jsonb);
END;
$function$;

-- ── get_despesa_arquivo: download (principal ou anexo extra) ─────────────────
CREATE OR REPLACE FUNCTION public.get_despesa_arquivo(p_user_id uuid, p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_nome text;
  v_mime text;
  v_b64 text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF p_kind = 'extra' THEN
    SELECT a.arquivo_nome, a.mime_type, encode(a.arquivo, 'base64')
    INTO v_nome, v_mime, v_b64
    FROM operations.despesa_anexos a
    JOIN operations.despesas d ON d.id = a.despesa_id
    WHERE a.id = p_id AND d.tenant_id = v_tenant_id;
  ELSE
    SELECT d.arquivo_nome, d.mime_type, encode(d.arquivo, 'base64')
    INTO v_nome, v_mime, v_b64
    FROM operations.despesas d
    WHERE d.id = p_id AND d.tenant_id = v_tenant_id;
  END IF;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Arquivo não encontrado';
  END IF;

  RETURN jsonb_build_object('arquivo_nome', v_nome, 'mime_type', v_mime, 'arquivo_base64', v_b64);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_despesa_arquivo(uuid, text, uuid) TO authenticated, service_role;
