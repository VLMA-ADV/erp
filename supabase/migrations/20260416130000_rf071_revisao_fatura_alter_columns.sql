-- RF-071 Z-2: colunas de auditoria em billing_items (revisão / aprovação).
ALTER TABLE finance.billing_items
  ADD COLUMN IF NOT EXISTS data_revisao timestamptz,
  ADD COLUMN IF NOT EXISTS data_aprovacao timestamptz,
  ADD COLUMN IF NOT EXISTS responsavel_revisao_id uuid,
  ADD COLUMN IF NOT EXISTS responsavel_aprovacao_id uuid;
