-- MVP: reajuste financeiro automático de casos ativos (taxas fixas por índice).
-- Ver SPEC alinhamento / operação manual via edge aplicar-reajuste ou cron futuro.

CREATE TABLE IF NOT EXISTS contracts.reajuste_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  caso_id uuid NOT NULL REFERENCES contracts.casos (id) ON DELETE CASCADE,
  data_reajuste date NOT NULL DEFAULT CURRENT_DATE,
  indice text,
  fator_aplicado numeric(18, 10) NOT NULL,
  campo_reajustado text NOT NULL,
  valor_anterior numeric(18, 4),
  valor_novo numeric(18, 4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reajuste_log_caso_id ON contracts.reajuste_log (caso_id);
CREATE INDEX IF NOT EXISTS idx_reajuste_log_tenant_created ON contracts.reajuste_log (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.aplicar_reajuste_casos(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, contracts
AS $$
DECLARE
  r RECORD;
  cfg jsonb;
  new_cfg jsonb;
  fator numeric;
  annual_rate numeric;
  oldv numeric;
  newv numeric;
  field_name text;
  months_step int;
  casos_count int := 0;
  detail jsonb := '[]'::jsonb;
  one_row jsonb;
BEGIN
  FOR r IN
    SELECT c.*
    FROM contracts.casos c
    WHERE c.possui_reajuste IS TRUE
      AND c.periodo_reajuste IS NOT NULL
      AND lower(trim(c.periodo_reajuste)) <> 'nao_tem'
      AND c.indice_reajuste IS NOT NULL
      AND lower(trim(c.indice_reajuste)) <> 'nao_tem'
      AND c.data_proximo_reajuste IS NOT NULL
      AND c.data_proximo_reajuste <= CURRENT_DATE
      AND c.status = 'ativo'
      AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
  LOOP
    annual_rate := CASE lower(trim(r.indice_reajuste))
      WHEN 'ipca' THEN 0.045
      WHEN 'selic' THEN 0.1325
      WHEN 'igp-m' THEN 0.035
      WHEN 'igpm' THEN 0.035
      WHEN 'inpc' THEN 0.04
      ELSE 0.04
    END;

    fator := CASE lower(trim(r.periodo_reajuste))
      WHEN 'mensal' THEN annual_rate / 12.0
      WHEN 'bimestral' THEN annual_rate / 6.0
      WHEN 'trimestral' THEN annual_rate / 4.0
      WHEN 'semestral' THEN annual_rate / 2.0
      WHEN 'anual' THEN annual_rate
      ELSE annual_rate / 12.0
    END;

    months_step := CASE lower(trim(r.periodo_reajuste))
      WHEN 'mensal' THEN 1
      WHEN 'bimestral' THEN 2
      WHEN 'trimestral' THEN 3
      WHEN 'semestral' THEN 6
      WHEN 'anual' THEN 12
      ELSE 1
    END;

    cfg := COALESCE(r.regra_cobranca_config, '{}'::jsonb);
    new_cfg := cfg;

    FOREACH field_name IN ARRAY ARRAY['valor_mensal', 'valor_hora', 'valor_projeto']::text[]
    LOOP
      CONTINUE WHEN NOT (cfg ? field_name);
      BEGIN
        oldv := (nullif(trim(cfg ->> field_name), ''))::numeric;
      EXCEPTION WHEN OTHERS THEN
        oldv := NULL;
      END;
      CONTINUE WHEN oldv IS NULL;

      newv := round(oldv * (1 + fator), 4);
      CONTINUE WHEN newv = oldv;

      new_cfg := jsonb_set(new_cfg, ARRAY[field_name], to_jsonb(newv), true);

      INSERT INTO contracts.reajuste_log (
        tenant_id,
        caso_id,
        data_reajuste,
        indice,
        fator_aplicado,
        campo_reajustado,
        valor_anterior,
        valor_novo
      ) VALUES (
        r.tenant_id,
        r.id,
        CURRENT_DATE,
        r.indice_reajuste,
        fator,
        field_name,
        oldv,
        newv
      );
    END LOOP;

    IF new_cfg IS DISTINCT FROM cfg THEN
      UPDATE contracts.casos c
      SET
        regra_cobranca_config = new_cfg,
        data_ultimo_reajuste = r.data_proximo_reajuste,
        data_proximo_reajuste = (r.data_proximo_reajuste + (months_step || ' months')::interval)::date,
        updated_at = now()
      WHERE c.id = r.id;

      casos_count := casos_count + 1;
      one_row := jsonb_build_object(
        'caso_id', r.id,
        'indice', r.indice_reajuste,
        'periodo', r.periodo_reajuste,
        'fator', fator
      );
      detail := detail || jsonb_build_array(one_row);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'casos_reajustados', casos_count,
    'detalhe', detail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_reajuste_casos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_reajuste_casos(uuid) TO service_role;
