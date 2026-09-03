-- =====================================================================
-- Corrigir a data do lancamento leva a competencia junto
--
-- Filipe, 03/09 (video): "eu lancei ela hoje, como se fosse dia 3 de agosto...
-- esses caras deveriam aparecer aqui pra eu continuar a jornada... mas nem isso
-- ele ta aparecendo... nem atualizando a lista".
--
-- O QUE ACONTECEU, e o defeito e do gatilho que eu escrevi em 31/08:
--   1. ele cria o lancamento com a data de hoje (03/09) -> gatilho grava
--      competencia 01/10, correto para trabalho de setembro;
--   2. 21 segundos depois ele CORRIGE a data para 03/08;
--   3. o gatilho nao recalcula, porque eu o fiz "so preenche o que esta vazio".
--   Resultado: trabalho de agosto cobrando em outubro, invisivel na fila de
--   setembro. A tela nao mentia — a hora estava em outro mes.
--
-- A regra "so preenche o que esta vazio" existia para nao desfazer um
-- adiamento feito de proposito, e isso continua valendo. A distincao: se a
-- competencia atual e EXATAMENTE a que o gatilho teria calculado para a data
-- ANTIGA, ela foi automatica e deve seguir a data nova. Se e outra coisa,
-- alguem escolheu — e escolha de gente nao se desfaz sozinha.
-- =====================================================================

CREATE OR REPLACE FUNCTION operations._periodo_faturamento_padrao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_automatico_antes date;
BEGIN
  IF NEW.data_lancamento IS NULL THEN
    RETURN NEW;
  END IF;

  -- Vazio: preenche (caso da criação).
  IF NEW.periodo_faturamento IS NULL THEN
    NEW.periodo_faturamento :=
      (date_trunc('month', NEW.data_lancamento::date) + interval '1 month')::date;
    RETURN NEW;
  END IF;

  -- Correção da data do trabalho: a competência acompanha, MAS só se ela
  -- ainda for a automática da data antiga.
  IF TG_OP = 'UPDATE'
     AND OLD.data_lancamento IS NOT NULL
     AND NEW.data_lancamento IS DISTINCT FROM OLD.data_lancamento
     AND NEW.periodo_faturamento IS NOT DISTINCT FROM OLD.periodo_faturamento
  THEN
    v_automatico_antes :=
      (date_trunc('month', OLD.data_lancamento::date) + interval '1 month')::date;

    IF OLD.periodo_faturamento IS NOT DISTINCT FROM v_automatico_antes THEN
      NEW.periodo_faturamento :=
        (date_trunc('month', NEW.data_lancamento::date) + interval '1 month')::date;
    END IF;
  END IF;

  RETURN NEW;
END $$;
