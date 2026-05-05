-- Feature F: Solicitação de Mensagem solta (avulsa).
-- Daily Filipe 30/04 + 04/05: mensagens não-vinculadas a solicitação de contrato,
-- com 4 campos (Cliente / Caso / Mensagem / Arquivos). Migration aditiva — não dropa nada.
--
-- Mudanças:
--   1. solicitacao_id passa a aceitar NULL (mensagens avulsas).
--   2. Novas colunas caso_id e cliente_id em contracts.solicitacao_mensagens.
--   3. CHECK garantindo ao menos um vínculo.
--   4. Indexes para inbox.
--   5. Tabela contracts.solicitacao_mensagens_anexos (espelha solicitacoes_contrato_anexos).
--   6. RPC create_mensagem_avulsa(p_user_id, p_payload jsonb) — segue padrão
--      do create_solicitacao_contrato para tratar bytea via decode(base64).

-- 1) Permitir mensagens sem vínculo a solicitacao_contrato
ALTER TABLE contracts.solicitacao_mensagens
  ALTER COLUMN solicitacao_id DROP NOT NULL;

-- 2) Vínculos opcionais para o fluxo avulso
ALTER TABLE contracts.solicitacao_mensagens
  ADD COLUMN IF NOT EXISTS caso_id UUID REFERENCES contracts.casos(id) ON DELETE SET NULL;

ALTER TABLE contracts.solicitacao_mensagens
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES crm.clientes(id) ON DELETE SET NULL;

-- 3) Ao menos um vínculo por mensagem
ALTER TABLE contracts.solicitacao_mensagens
  DROP CONSTRAINT IF EXISTS solicitacao_mensagens_vinculo_chk;

ALTER TABLE contracts.solicitacao_mensagens
  ADD CONSTRAINT solicitacao_mensagens_vinculo_chk
  CHECK (solicitacao_id IS NOT NULL OR caso_id IS NOT NULL OR cliente_id IS NOT NULL);

-- 4) Indexes para inbox (avulsas) + filtros por caso/cliente
CREATE INDEX IF NOT EXISTS idx_solicitacao_mensagens_avulsas_created
  ON contracts.solicitacao_mensagens (tenant_id, created_at DESC)
  WHERE solicitacao_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_solicitacao_mensagens_caso
  ON contracts.solicitacao_mensagens (caso_id, created_at DESC)
  WHERE caso_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_solicitacao_mensagens_cliente
  ON contracts.solicitacao_mensagens (cliente_id, created_at DESC)
  WHERE cliente_id IS NOT NULL;

-- 5) Tabela de anexos de mensagens avulsas
CREATE TABLE IF NOT EXISTS contracts.solicitacao_mensagens_anexos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  mensagem_id     UUID NOT NULL REFERENCES contracts.solicitacao_mensagens(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  arquivo_nome    TEXT NOT NULL,
  mime_type       TEXT,
  tamanho_bytes   BIGINT,
  arquivo         BYTEA,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_solicitacao_mensagens_anexos_mensagem
  ON contracts.solicitacao_mensagens_anexos (mensagem_id);

CREATE INDEX IF NOT EXISTS idx_solicitacao_mensagens_anexos_tenant
  ON contracts.solicitacao_mensagens_anexos (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON contracts.solicitacao_mensagens_anexos
  TO authenticated, service_role;

ALTER TABLE contracts.solicitacao_mensagens_anexos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'contracts'
      AND tablename = 'solicitacao_mensagens_anexos'
      AND policyname = 'tenant_isolation_solicitacao_mensagens_anexos'
  ) THEN
    CREATE POLICY tenant_isolation_solicitacao_mensagens_anexos
      ON contracts.solicitacao_mensagens_anexos
      FOR ALL
      TO public
      USING (core.user_belongs_to_tenant(tenant_id));
  END IF;
END $$;

-- 6) RPC: create_mensagem_avulsa
-- Mesma estratégia de create_solicitacao_contrato (RF-010): bytea via decode(base64)
-- e validação de tenant_id por core.tenant_users + people.colaboradores.
CREATE OR REPLACE FUNCTION public.create_mensagem_avulsa(
  p_user_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_colaborador_id uuid;
  v_cliente_id uuid;
  v_caso_id uuid;
  v_mensagem text;
  v_id uuid;
  v_anexo jsonb;
BEGIN
  -- tenant a partir de tenant_users
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- colaborador (autor) — necessário pois autor_id referencia people.colaboradores
  SELECT c.id INTO v_colaborador_id
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id
    AND c.tenant_id = v_tenant_id
  LIMIT 1;

  IF v_colaborador_id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado para o usuário';
  END IF;

  v_cliente_id := NULLIF(p_payload->>'cliente_id', '')::uuid;
  v_caso_id := NULLIF(p_payload->>'caso_id', '')::uuid;
  v_mensagem := COALESCE(NULLIF(trim(p_payload->>'mensagem'), ''), '');

  IF v_mensagem = '' THEN
    RAISE EXCEPTION 'Mensagem é obrigatória';
  END IF;

  IF v_cliente_id IS NULL AND v_caso_id IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um vínculo: cliente ou caso';
  END IF;

  -- Validações de pertencimento ao tenant (defensive)
  IF v_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.clientes WHERE id = v_cliente_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  IF v_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos WHERE id = v_caso_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  -- INSERT mensagem (solicitacao_id = NULL → avulsa)
  INSERT INTO contracts.solicitacao_mensagens (
    solicitacao_id,
    cliente_id,
    caso_id,
    autor_id,
    mensagem,
    tenant_id
  ) VALUES (
    NULL,
    v_cliente_id,
    v_caso_id,
    v_colaborador_id,
    v_mensagem,
    v_tenant_id
  ) RETURNING id INTO v_id;

  -- Anexos (opcional)
  IF jsonb_typeof(p_payload->'anexos') = 'array' THEN
    FOR v_anexo IN SELECT value FROM jsonb_array_elements(p_payload->'anexos')
    LOOP
      IF NULLIF(v_anexo->>'arquivo_base64', '') IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO contracts.solicitacao_mensagens_anexos (
        tenant_id,
        mensagem_id,
        nome,
        arquivo_nome,
        mime_type,
        tamanho_bytes,
        arquivo,
        created_by
      ) VALUES (
        v_tenant_id,
        v_id,
        COALESCE(NULLIF(trim(v_anexo->>'nome'), ''),
                 NULLIF(v_anexo->>'arquivo_nome', ''),
                 'Anexo'),
        COALESCE(NULLIF(v_anexo->>'arquivo_nome', ''), 'anexo.bin'),
        NULLIF(v_anexo->>'mime_type', ''),
        NULLIF(v_anexo->>'tamanho_bytes', '')::bigint,
        decode(v_anexo->>'arquivo_base64', 'base64'),
        p_user_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'tenant_id', v_tenant_id,
    'cliente_id', v_cliente_id,
    'caso_id', v_caso_id,
    'autor_id', v_colaborador_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_mensagem_avulsa(uuid, jsonb)
  TO authenticated, service_role;
