-- Bug "solicitar novo contrato": a FK fk_solicitacao_centro_custo apontava para
-- people.centros_custo (vazia: 0 registros), mas o valor gravado em
-- solicitacoes_contrato.centro_custo_id é um id de people.areas — o dropdown
-- "Centro de custo" do formulário lista ÁREAS (areasOptions), incluindo
-- "Proporcional ao centro de custo". Logo, QUALQUER centro de custo escolhido
-- violava a FK e o insert falhava (erro do print do cliente).
--
-- Correção: repontar a FK para people.areas (a tabela real do valor). ON DELETE
-- SET NULL para não travar exclusão de área. Idempotente.

ALTER TABLE contracts.solicitacoes_contrato
  DROP CONSTRAINT IF EXISTS fk_solicitacao_centro_custo;

ALTER TABLE contracts.solicitacoes_contrato
  ADD CONSTRAINT fk_solicitacao_centro_custo
  FOREIGN KEY (centro_custo_id) REFERENCES people.areas(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
