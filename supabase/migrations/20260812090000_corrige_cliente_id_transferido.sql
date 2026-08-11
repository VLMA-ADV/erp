-- Corrige billing_items cujo cliente_id ficou desatualizado apos "Transferir
-- caso" (bug consertado em update-faturamento-item/index.ts em 12/08).
--
-- O contrato_id/caso_id ja iam para o destino certo; cliente_id, denormalizado
-- na tabela, nao acompanhava. get_revisao_fatura junta o nome do cliente por
-- bi.cliente_id, entao o item aparecia com o caso e contrato corretos mas sob
-- o card do CLIENTE ANTIGO — foi o "migrou o caso da 7holding para a campo
-- rico" que o Filipe reportou.
UPDATE finance.billing_items bi
SET cliente_id = c.cliente_id,
    updated_at = now()
FROM contracts.contratos c
WHERE c.id = bi.contrato_id
  AND bi.cliente_id <> c.cliente_id;
