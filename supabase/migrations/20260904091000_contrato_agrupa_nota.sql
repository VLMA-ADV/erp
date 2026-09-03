-- =====================================================================
-- Onde fica a escolha: por caso (padrao) ou agrupado no contrato
--
-- Filipe, 03/09: "seria possivel criar uma funcao de poder escolher se e por
-- caso ou agrupar os valores dos casos e somar numa unica nota ou num unico
-- boleto? ter essa flexibilidade".
--
-- A escolha mora no CONTRATO, nao no momento de emitir. Cadastra-se uma vez e
-- ninguem precisa decidir todo mes — decisao tomada as pressas, no dia do
-- faturamento, e a que erra. Quem quiser o contrario continua podendo agrupar
-- marcando o contrato.
--
-- Padrao FALSE = por caso, que e a regra que ele pediu. Contratos existentes
-- nascem com o padrao novo; quem quiser manter agrupado marca o contrato.
-- =====================================================================

ALTER TABLE contracts.contratos
  ADD COLUMN IF NOT EXISTS agrupar_nota_por_contrato boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contracts.contratos.agrupar_nota_por_contrato IS
  'Quando true, os casos aprovados entram numa nota so. Padrao false: uma nota por caso.';
