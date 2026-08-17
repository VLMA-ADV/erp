-- =====================================================================
-- CENTROS DE CUSTO: usar a lista oficial, não uma paralela
--
-- Filipe, 17/08: "precisa vincular a lista de centros de custos na tela de
-- nova conta com os centros de custos oficiais criados (societário, verve,
-- vlma, tern etc)".
--
-- O que estava acontecendo: quando o módulo de contas a pagar nasceu, ele
-- criou finance.centros_custo com uma lista PRÓPRIA, de categorias de despesa
-- ("Despesas Administrativas", "Imóvel", "Impostos Diretos"…). Só que a casa
-- já tinha uma lista de centros de custo — people.areas — e é ela que os
-- contratos, os casos e as pessoas usam. Duas listas para a mesma coisa, e a
-- tela de nova conta oferecia a errada.
--
-- Não dá para simplesmente apontar o lançamento para people.areas: a coluna
-- finance.lancamentos.centro_custo_id referencia finance.centros_custo, e há
-- 36 lançamentos já classificados. Então a lista oficial é COPIADA para
-- finance.centros_custo (mesma chave estrangeira, mesmo histórico) e as
-- categorias antigas saem do ar.
--
-- "Proporcional ao centro de custo" fica de fora de propósito: é uma opção de
-- rateio de contrato, não um centro de custo. E as áreas inativas também.
-- =====================================================================

-- 1. Traz as áreas oficiais que ainda não existem em finance.centros_custo.
--    Casa por nome: "Contencioso" existe nas duas listas e é a mesma coisa —
--    duplicar criaria dois centros idênticos no seletor.
INSERT INTO finance.centros_custo (tenant_id, nome, ativo)
SELECT a.tenant_id, trim(a.nome), true
FROM people.areas a
WHERE a.ativo
  AND trim(a.nome) <> ''
  AND lower(trim(a.nome)) <> 'proporcional ao centro de custo'
  AND lower(trim(a.nome)) NOT LIKE 'teste%'
  AND NOT EXISTS (
    SELECT 1 FROM finance.centros_custo cc
    WHERE cc.tenant_id = a.tenant_id
      AND lower(trim(cc.nome)) = lower(trim(a.nome))
  );

-- Uma área que existia mas estava desligada volta a aparecer.
UPDATE finance.centros_custo cc SET ativo = true, updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM people.areas a
  WHERE a.tenant_id = cc.tenant_id AND a.ativo
    AND lower(trim(a.nome)) = lower(trim(cc.nome))
) AND NOT cc.ativo;

-- 2. Tira do seletor as categorias antigas, que não são centros de custo.
--    DESATIVA, não apaga: os 36 lançamentos já classificados continuam
--    mostrando o centro com que foram lançados, e nenhum histórico se perde.
--    Se algum dia o escritório quiser uma de volta, é um clique.
UPDATE finance.centros_custo cc SET ativo = false, updated_at = now()
WHERE cc.ativo
  AND NOT EXISTS (
    SELECT 1 FROM people.areas a
    WHERE a.tenant_id = cc.tenant_id AND a.ativo
      AND lower(trim(a.nome)) = lower(trim(cc.nome))
  );

-- 3. Solta as contas contábeis que estavam presas a uma categoria antiga.
--    A tela de nova conta filtra a conta contábil pelo centro escolhido
--    (mostra as sem centro + as do centro). Presas a um centro que saiu do
--    seletor, essas 7 contas sumiriam para TODOS os centros — o campo ficaria
--    vazio sem explicar por quê. Sem centro, elas valem para qualquer um, que
--    é o certo: plano de contas e centro de custo são coisas independentes.
UPDATE finance.contas_contabeis x SET centro_custo_id = NULL, updated_at = now()
WHERE x.centro_custo_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM finance.centros_custo cc
    WHERE cc.id = x.centro_custo_id AND NOT cc.ativo
  );
