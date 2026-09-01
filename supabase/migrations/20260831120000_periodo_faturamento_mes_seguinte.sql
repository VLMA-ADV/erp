-- =====================================================================
-- Hora trabalhada no mes X e cobrada no mes X+1
--
-- Filipe, 31/08, sem exececao: "trabalha num mes de 1 a 31 e cobra-se no mes
-- seguinte. Essa regra vale sempre? Sim!"
--
-- O campo periodo_faturamento existia para isso e estava vazio em 1.827 das
-- 1.828 horas de agosto. Sem ele, get_itens_a_faturar cai no COALESCE e usa
-- data_lancamento — entao as horas de agosto apareciam em AGOSTO, e setembro
-- mostrava so as mensalidades. Ninguem tinha errado o lancamento: o campo nunca
-- foi explicado e a tela nao pede.
--
-- Duas partes:
--   1. gatilho, para nunca mais depender de alguem lembrar;
--   2. backfill do que ja existe.
--
-- O backfill e seguro AGORA e provavelmente so agora: finance.billing_items
-- esta vazia, entao nenhuma hora foi faturada e nada de historico muda. Depois
-- do primeiro faturamento isto deixaria de ser verdade.
-- =====================================================================

CREATE OR REPLACE FUNCTION operations._periodo_faturamento_padrao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Só preenche o que está vazio. Valor informado a mão continua valendo — se
  -- alguem adiou uma hora de proposito, o gatilho nao desfaz.
  IF NEW.periodo_faturamento IS NULL AND NEW.data_lancamento IS NOT NULL THEN
    NEW.periodo_faturamento :=
      (date_trunc('month', NEW.data_lancamento::date) + interval '1 month')::date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_periodo_faturamento_padrao ON operations.timesheets;
CREATE TRIGGER trg_periodo_faturamento_padrao
  BEFORE INSERT OR UPDATE ON operations.timesheets
  FOR EACH ROW EXECUTE FUNCTION operations._periodo_faturamento_padrao();

UPDATE operations.timesheets
   SET periodo_faturamento = (date_trunc('month', data_lancamento::date) + interval '1 month')::date
 WHERE periodo_faturamento IS NULL
   AND data_lancamento IS NOT NULL;
