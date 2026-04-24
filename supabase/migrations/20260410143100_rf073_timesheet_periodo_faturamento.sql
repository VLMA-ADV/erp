-- RF-073: Postergar lançamento de timesheet para outro período de faturamento.
-- Coluna opcional: quando preenchida, define a competência/período de faturamento alvo
-- (ex.: primeiro dia do mês). NULL preserva o comportamento anterior à feature.

ALTER TABLE operations.timesheets
  ADD COLUMN IF NOT EXISTS periodo_faturamento DATE NULL;

COMMENT ON COLUMN operations.timesheets.periodo_faturamento IS
  'Período de faturamento pretendido para o lançamento; NULL = deriva das regras legadas (ex. data_lancamento).';
