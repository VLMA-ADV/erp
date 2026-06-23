-- Cleanup: remove o sistema de temperatura por LISTA (v1.7), substituído pela
-- barra percentual (temperatura_pct, v1.8). Remove RPCs, coluna FK e tabela.

DROP FUNCTION IF EXISTS public.set_crm_card_temperatura(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.create_crm_temperatura(uuid, text);
DROP FUNCTION IF EXISTS public.list_crm_temperaturas(uuid);

ALTER TABLE crm.pipeline_cards DROP COLUMN IF EXISTS temperatura_id;

DROP TABLE IF EXISTS crm.temperaturas;
