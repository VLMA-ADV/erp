-- BUG-004: exclusão de anexos (contrato/caso) falhava para sessão autenticada
-- Causa: RLS sem policies em contrato_anexos/caso_anexos; sem GRANT para authenticated;
-- solicitacoes_contrato_anexos sem privilégios adequados para service_role.
--
-- Alinha com RULES.md §2–3 (tenant_id + RLS) e o padrão de people.colaboradores
-- (core.user_belongs_to_tenant). RBAC fino (ex.: só sócio remove anexo) permanece na
-- edge function (RNF-002); o banco garante isolamento por tenant.

GRANT SELECT, INSERT, UPDATE, DELETE ON contracts.contrato_anexos TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON contracts.caso_anexos TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON contracts.solicitacoes_contrato_anexos TO authenticated, service_role;

ALTER TABLE contracts.solicitacoes_contrato_anexos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'contracts' AND tablename = 'contrato_anexos'
      AND policyname = 'tenant_isolation_contrato_anexos'
  ) THEN
    CREATE POLICY tenant_isolation_contrato_anexos ON contracts.contrato_anexos
      FOR ALL
      TO public
      USING (core.user_belongs_to_tenant(tenant_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'contracts' AND tablename = 'caso_anexos'
      AND policyname = 'tenant_isolation_caso_anexos'
  ) THEN
    CREATE POLICY tenant_isolation_caso_anexos ON contracts.caso_anexos
      FOR ALL
      TO public
      USING (core.user_belongs_to_tenant(tenant_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'contracts' AND tablename = 'solicitacoes_contrato_anexos'
      AND policyname = 'tenant_isolation_solicitacoes_contrato_anexos'
  ) THEN
    CREATE POLICY tenant_isolation_solicitacoes_contrato_anexos
      ON contracts.solicitacoes_contrato_anexos
      FOR ALL
      TO public
      USING (core.user_belongs_to_tenant(tenant_id));
  END IF;
END $$;
