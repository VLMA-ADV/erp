-- =====================================================================
-- Despesa de agosto e cobrada em setembro — mesma regra da hora
--
-- Filipe, 01/09: "as despesas realizadas em agosto tambem sao cobradas em
-- setembro... entao despesas e horas seguem a mesma regra".
--
-- Espelha exatamente o que foi feito com timesheets em 31/08: campo de
-- competencia + gatilho + backfill. Nao inventa um segundo jeito de resolver o
-- mesmo problema — quem entender um entende o outro.
--
-- CUIDADO QUE MOTIVOU O DESENHO: get_despesas serve TAMBEM a tela de Despesas,
-- onde filtrar agosto tem de mostrar agosto. Por isso o filtro por competencia
-- e OPCIONAL, ligado so por quem fatura (p_filters->>'por_competencia').
-- Mudar o filtro no geral quebraria a tela de quem lanca despesa.
-- =====================================================================

ALTER TABLE operations.despesas
  ADD COLUMN IF NOT EXISTS periodo_faturamento date;

COMMENT ON COLUMN operations.despesas.periodo_faturamento IS
  'Mes em que a despesa e cobrada. Padrao: mes seguinte ao do lancamento.';

CREATE OR REPLACE FUNCTION operations._despesa_periodo_faturamento_padrao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Só preenche o que está vazio: valor informado a mão continua valendo.
  IF NEW.periodo_faturamento IS NULL AND NEW.data_lancamento IS NOT NULL THEN
    NEW.periodo_faturamento :=
      (date_trunc('month', NEW.data_lancamento::date) + interval '1 month')::date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_despesa_periodo_faturamento ON operations.despesas;
CREATE TRIGGER trg_despesa_periodo_faturamento
  BEFORE INSERT OR UPDATE ON operations.despesas
  FOR EACH ROW EXECUTE FUNCTION operations._despesa_periodo_faturamento_padrao();

UPDATE operations.despesas
   SET periodo_faturamento = (date_trunc('month', data_lancamento::date) + interval '1 month')::date
 WHERE periodo_faturamento IS NULL
   AND data_lancamento IS NOT NULL;
