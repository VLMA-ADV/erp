-- RF-064 (Onda 2 / V-1): número sequencial por tenant em contracts.contratos
-- RULES.md: schema contracts; backward-compatible (nullable); RLS inalterada na tabela.
--
-- - Coluna opcional para contratos legados; backfill por created_at.
-- - contracts.proximo_numero_sequencial_contrato + público para RPC.
-- - BEFORE INSERT: preenche numero_sequencial quando NULL (create_contrato inalterado).

ALTER TABLE contracts.contratos
  ADD COLUMN IF NOT EXISTS numero_sequencial INTEGER;

COMMENT ON COLUMN contracts.contratos.numero_sequencial IS
  'Sequencial por tenant (RF-064); UI pode exibir "Contrato N"; nome_contrato permanece como fallback';

-- Backfill: 1..N por tenant, ordem de criação
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS seq
  FROM contracts.contratos
  WHERE numero_sequencial IS NULL
)
UPDATE contracts.contratos c
SET numero_sequencial = o.seq
FROM ordered o
WHERE c.id = o.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contratos_tenant_numero_sequencial_unique
  ON contracts.contratos (tenant_id, numero_sequencial)
  WHERE numero_sequencial IS NOT NULL;

CREATE OR REPLACE FUNCTION contracts.proximo_numero_sequencial_contrato(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = contracts, pg_temp
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));
  SELECT COALESCE(MAX(numero_sequencial), 0) + 1 INTO v_next
  FROM contracts.contratos
  WHERE tenant_id = p_tenant_id;
  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION contracts.proximo_numero_sequencial_contrato(uuid) IS
  'Próximo numero_sequencial do tenant; lock transacional contra corrida (RF-064).';

CREATE OR REPLACE FUNCTION public.proximo_numero_sequencial_contrato(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = contracts, pg_temp
AS $$
  SELECT contracts.proximo_numero_sequencial_contrato(p_tenant_id);
$$;

COMMENT ON FUNCTION public.proximo_numero_sequencial_contrato(uuid) IS
  'RPC: próximo número sequencial de contrato por tenant (RF-064).';

CREATE OR REPLACE FUNCTION contracts.trg_contratos_assign_numero_sequencial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = contracts, pg_temp
AS $$
BEGIN
  IF NEW.numero_sequencial IS NULL THEN
    NEW.numero_sequencial := contracts.proximo_numero_sequencial_contrato(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_contratos_assign_numero_sequencial ON contracts.contratos;
CREATE TRIGGER tr_contratos_assign_numero_sequencial
  BEFORE INSERT ON contracts.contratos
  FOR EACH ROW
  EXECUTE FUNCTION contracts.trg_contratos_assign_numero_sequencial();

REVOKE ALL ON FUNCTION contracts.proximo_numero_sequencial_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contracts.proximo_numero_sequencial_contrato(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.proximo_numero_sequencial_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proximo_numero_sequencial_contrato(uuid) TO authenticated, service_role;
