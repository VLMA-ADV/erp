-- =====================================================================
-- Data de inicio de faturamento nao aceita mais ano impossivel
--
-- O caso 57 (Bravia, R$ 1.251/mes) ficou gravado com 20206-05-01 — um zero a
-- mais no ano. O generate_series da fila de faturar comeca em GREATEST(data,
-- inicio_do_mes), entao a serie saia vazia e o caso nunca aparecia. Em mes
-- nenhum, desde sempre, sem erro e sem aviso.
--
-- O campo aceitava isso porque nada validava, e ninguem via porque o campo nao
-- tinha input em tela (corrigido no mesmo PR). Um erro de tecla custava a
-- mensalidade inteira, calada.
--
-- O gatilho cobre os DOIS lugares onde a data mora: a coluna do caso e a copia
-- dentro de cada regra em regras_financeiras. No caso 57 estava errada nos dois.
-- =====================================================================

CREATE OR REPLACE FUNCTION contracts._valida_data_faturamento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_ano int;
  v_regra jsonb;
  v_data text;
BEGIN
  IF NEW.data_inicio_faturamento IS NOT NULL THEN
    v_ano := EXTRACT(YEAR FROM NEW.data_inicio_faturamento)::int;
    IF v_ano < 1990 OR v_ano > 2100 THEN
      RAISE EXCEPTION 'Data de início de faturamento com ano inválido (%): confira se não sobrou um dígito', v_ano;
    END IF;
  END IF;

  IF jsonb_typeof(NEW.regras_financeiras) = 'array' THEN
    FOR v_regra IN SELECT * FROM jsonb_array_elements(NEW.regras_financeiras) LOOP
      v_data := NULLIF(v_regra->>'data_inicio_faturamento', '');
      IF v_data IS NOT NULL THEN
        BEGIN
          v_ano := EXTRACT(YEAR FROM v_data::date)::int;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Data de início de faturamento inválida na regra: %', v_data;
        END;
        IF v_ano < 1990 OR v_ano > 2100 THEN
          RAISE EXCEPTION 'Data de início de faturamento da regra com ano inválido (%): confira se não sobrou um dígito', v_ano;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_valida_data_faturamento ON contracts.casos;
CREATE TRIGGER trg_valida_data_faturamento
  BEFORE INSERT OR UPDATE ON contracts.casos
  FOR EACH ROW EXECUTE FUNCTION contracts._valida_data_faturamento();
