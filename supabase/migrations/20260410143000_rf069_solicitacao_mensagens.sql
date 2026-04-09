-- RF-069: Caixa de mensagens nas solicitações de contrato (protótipo).
-- Tabela de domínio em contracts; RLS por tenant (RULES.md §2).

CREATE TABLE IF NOT EXISTS contracts.solicitacao_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id UUID NOT NULL REFERENCES contracts.solicitacoes_contrato (id) ON DELETE CASCADE,
  contrato_id UUID NULL REFERENCES contracts.contratos (id) ON DELETE SET NULL,
  autor_id UUID NOT NULL REFERENCES people.colaboradores (id) ON DELETE RESTRICT,
  mensagem TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solicitacao_mensagens_tenant_solic_created
  ON contracts.solicitacao_mensagens (tenant_id, solicitacao_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON contracts.solicitacao_mensagens TO authenticated, service_role;

ALTER TABLE contracts.solicitacao_mensagens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'contracts'
      AND tablename = 'solicitacao_mensagens'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON contracts.solicitacao_mensagens
      FOR ALL
      TO public
      USING (core.user_belongs_to_tenant(tenant_id));
  END IF;
END $$;
