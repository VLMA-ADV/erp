-- RF-058: Centro de custo (area_id) no card do pipeline CRM.
-- Backward-compatible: coluna nullable adicionada sem default.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm'
      AND table_name = 'pipeline_cards'
      AND column_name = 'area_id'
  ) THEN
    ALTER TABLE crm.pipeline_cards
      ADD COLUMN area_id UUID NULL REFERENCES people.areas (id) ON DELETE SET NULL;
  END IF;
END $$;
