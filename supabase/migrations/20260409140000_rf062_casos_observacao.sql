-- RF-062 (Onda 1 / U-6): campo "observação" em casos — dados básicos
-- Dependência para frontend + edges: coluna opcional, backward-compatible (RULES.md §2)

ALTER TABLE contracts.casos
  ADD COLUMN IF NOT EXISTS observacao TEXT;

COMMENT ON COLUMN contracts.casos.observacao IS 'Texto livre — RF-062; aba Dados básicos do caso';
