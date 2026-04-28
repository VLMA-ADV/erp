-- Bug B follow-up: CHECK constraint legado em contracts.casos.regra_cobranca
-- não incluía 'salario_minimo' (RF-088 esqueceu de atualizar). Causava 23514 ao
-- tentar salvar caso com regra=salario_minimo mesmo após relaxar o RAISE da RPC.
--
-- Filipe daily 27/04: "Para regra salário mínimo, quantidade_sm é obrigatória"
-- vinha primeiro (RAISE da RPC, fechado em
-- 20260428130100_relax_quantidade_sm_validation_in_caso_rpcs.sql); depois
-- bateria neste CHECK.
--
-- Aplicado em DEV via Cursor MCP em 2026-04-28 02:09 UTC. SQL idempotente.
-- Preserva 'hora_com_cap' que já existia no CHECK e adiciona 'salario_minimo'.

ALTER TABLE contracts.casos DROP CONSTRAINT IF EXISTS casos_regra_cobranca_check;

ALTER TABLE contracts.casos ADD CONSTRAINT casos_regra_cobranca_check
  CHECK (regra_cobranca IS NULL OR regra_cobranca IN (
    'hora',
    'hora_com_cap',
    'mensal',
    'mensalidade_processo',
    'salario_minimo',
    'projeto',
    'projeto_parcelado',
    'exito'
  ));
