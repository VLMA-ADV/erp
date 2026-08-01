-- Cargo de quem lançou, congelado no momento do lançamento.
--
-- Sem isto não há como cobrar por senioridade de forma honesta: a tabela de
-- preço é por cargo, e o cargo de uma pessoa muda (promoção). Lendo o cargo
-- ATUAL no momento de faturar, uma promoção reprecificaria retroativamente
-- horas antigas — inclusive de meses já revisados.
--
-- Decisão do cliente (31/07): vale o cargo da HORA DO LANÇAMENTO.
ALTER TABLE operations.timesheets
  ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES people.cargos(id);

COMMENT ON COLUMN operations.timesheets.cargo_id IS
  'Cargo de quem lançou, no momento do lançamento. Congela o preço por senioridade.';

CREATE INDEX IF NOT EXISTS idx_timesheets_cargo_id
  ON operations.timesheets(cargo_id) WHERE cargo_id IS NOT NULL;

-- Backfill: para lançamentos existentes usa-se o cargo ATUAL de quem lançou —
-- é a melhor aproximação disponível (não há histórico de cargo no sistema).
UPDATE operations.timesheets t
SET cargo_id = c.cargo_id
FROM people.colaboradores c
WHERE c.user_id = t.created_by
  AND c.tenant_id = t.tenant_id
  AND t.cargo_id IS NULL
  AND c.cargo_id IS NOT NULL;

-- create_timesheet passa a gravar o cargo junto.
CREATE OR REPLACE FUNCTION public.create_timesheet(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_cargo_id uuid;
  v_ia boolean := COALESCE(NULLIF(p_payload->>'ia_auxiliado', '')::boolean, false);
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

  -- Congela o cargo de quem está lançando, agora.
  SELECT c.cargo_id INTO v_cargo_id
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
  LIMIT 1;

  INSERT INTO operations.timesheets (
    tenant_id, contrato_id, caso_id, data_lancamento, horas, duracao_minutos,
    descricao, ia_auxiliado, ia_minutos, cargo_id, status, created_by, updated_by
  ) VALUES (
    v_tenant_id,
    (p_payload->>'contrato_id')::uuid,
    (p_payload->>'caso_id')::uuid,
    COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, now()::date),
    COALESCE(NULLIF(p_payload->>'horas', '')::numeric, 0),
    NULLIF(p_payload->>'duracao_minutos', '')::integer,
    COALESCE(NULLIF(p_payload->>'descricao', ''), ''),
    v_ia,
    CASE WHEN v_ia THEN NULLIF(p_payload->>'ia_minutos', '')::integer ELSE NULL END,
    v_cargo_id,
    'em_lancamento',
    p_user_id,
    p_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;
