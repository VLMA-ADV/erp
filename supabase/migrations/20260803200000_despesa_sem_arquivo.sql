-- Despesa pode ser lançada sem comprovante (pedido Filipe 03/08).
--
-- A exigência estava em três camadas — tela, esta função e o NOT NULL das
-- colunas. Mexer só na tela faria a gravação falhar no servidor.
--
-- Decisão de desenho: em vez de tornar o comprovante simplesmente opcional e
-- deixar a falta passar despercebida (foi assim que 6 clientes ficaram com
-- hora a R$ 0,00 em julho), a despesa sem arquivo fica VISÍVEL como pendente.
-- Quem for cobrar do cliente vê que falta comprovante antes de faturar.
ALTER TABLE operations.despesas
  ALTER COLUMN arquivo      DROP NOT NULL,
  ALTER COLUMN arquivo_nome DROP NOT NULL;

COMMENT ON COLUMN operations.despesas.arquivo IS
  'Comprovante. NULL = lançada sem comprovante, pendente de anexo.';

-- Marca de leitura fácil para tela e relatórios.
CREATE OR REPLACE FUNCTION operations.despesa_sem_comprovante(p_despesa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT d.arquivo IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM operations.despesa_anexos a WHERE a.despesa_id = d.id
     )
  FROM operations.despesas d
  WHERE d.id = p_despesa_id;
$function$;

-- create_despesa deixa de exigir o comprovante.
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

  -- Comprovante deixou de ser obrigatório (pedido Filipe 03/08): a despesa
  -- pode ser lançada na hora e o comprovante anexado depois. Sem arquivo, a
  -- despesa nasce marcada como pendente de comprovante (ver status abaixo).

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
    reembolsavel, created_by, updated_by
  ) VALUES (
    v_tenant_id, v_cliente_id, v_contrato_id, v_caso_id,
    COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, now()::date),
    trim(p_payload->>'categoria'),
    v_valor,
    COALESCE(p_payload->>'descricao', ''),
    'em_lancamento',
    NULLIF(trim(COALESCE(p_payload->>'arquivo_nome', '')), ''),
    NULLIF(p_payload->>'mime_type', ''),
    NULLIF(p_payload->>'tamanho_bytes', '')::bigint,
    CASE WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') = ''
         THEN NULL ELSE decode(p_payload->>'arquivo_base64', 'base64') END,
    COALESCE((p_payload->>'reembolsavel')::boolean, true),
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
$function$
;
