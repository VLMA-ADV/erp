-- BB-5: relaxar obrigatoriedade de cnpj em operations.parceiros.
-- Diretiva "forms soltos" (daily 22/04 e 23/04 com Filipe):
-- DB so trava PK/FK/tenant; identificadores de negocio como CNPJ
-- e demais campos ficam nullable no schema; validacao de UX vai no frontend.
-- Backward-compat (ADR-008): apenas relaxacao, nao muda tipo nem apaga dados.
-- Linhas existentes com CNPJ nao perdem o valor; novas linhas podem ter NULL.

BEGIN;

ALTER TABLE operations.parceiros ALTER COLUMN cnpj DROP NOT NULL;

COMMIT;
