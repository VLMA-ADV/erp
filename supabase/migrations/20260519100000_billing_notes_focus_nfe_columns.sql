-- Adiciona colunas para rastreamento Focus NFe em billing_notes
ALTER TABLE finance.billing_notes
  ADD COLUMN IF NOT EXISTS focus_ref    TEXT,
  ADD COLUMN IF NOT EXISTS focus_status TEXT DEFAULT 'pendente';
