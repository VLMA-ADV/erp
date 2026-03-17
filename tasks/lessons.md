# Lessons Learned

- Ao implementar fluxo paralelo ao de "casos", preservar compatibilidade do payload legado e sincronizar estado local com o card ativo para evitar perda de dados ao trocar contexto.
- Em estruturas JSON de regras financeiras, nunca embutir `regras_cobranca` dentro de cada `regra_cobranca_config`; sempre sanitizar para evitar aninhamento recursivo e `Maximum call stack size exceeded`.

- Na revisão de faturamento por timesheet, manter `horas iniciais` como baseline imutável e permitir CRUD completo das linhas (adicionar/remover/editar data, profissional, atividade, valor/hora e horas revisadas), calculando totais a partir das linhas revisadas.

- No modal de revisão de fatura, evitar abas genéricas: renderizar UI contextual por tipo de item e para regras financeiras usar tabela de itens/parcelas (não campos soltos), preservando coerência com mensalidade/projeto/êxito.
- Quando a revisão for em modo `timesheet` sobre item de regra financeira, nunca persistir horas/valor no item de regra: materializar/atualizar `operations.timesheets` e `finance.billing_items` de origem `timesheet`, com auditoria explícita por usuário.
- Em totais de faturamento/revisão, nunca usar fallback com `||` para horas/valores; usar `nullish` para preservar `0` revisado/aprovado e evitar divergência entre telas.
- Na RPC `get_revisao_fatura`, horas (`informadas/revisadas/aprovadas`) devem ser forçadas a zero para `origem_tipo <> 'timesheet'` para impedir vazamento de horas em itens de regra financeira.
- Em faturamento/revisão, cálculo de `valor em aberto` deve usar precedência `valor_aprovado -> valor_revisado -> valor_informado`; usar apenas revisado/informado gera divergência após aprovação.
- Em modais com `CommandSelect` dentro de containers com borda, evitar `overflow-hidden` para não cortar o dropdown; em listas com nomes longos, definir largura mínima e altura máxima no painel de seleção.
- Na tabela de etapas da revisão/aprovação, aplicar visibilidade por usuário (`sua etapa + etapas anteriores`) e bloquear edição fora da sua linha; troca de responsável só para admin e apenas em etapas não concluídas.
- Em aprovação, o valor/hora aprovados devem usar estado dedicado e nunca sobrescrever `valor_revisado`/`horas_revisadas`; edição do aprovador deve persistir apenas em `*_aprovado`.
- Em seletores dentro de modais longos, o dropdown deve abrir para cima automaticamente quando não houver espaço abaixo para manter os itens clicáveis.
- Em revisão de faturamento, `get-contratos` pode não trazer `timesheet_config` dos casos; quando isso ocorrer, usar fallback em `get-contrato` para montar revisores/aprovadores e pré-seleção correta de responsável.
- Antes de usar `operations.despesas.valor` em RPCs de faturamento, garantir migration de coluna (`ADD COLUMN IF NOT EXISTS valor`) porque ambientes antigos de despesas não possuem esse campo.
- Em ajustes de regras financeiras no contrato, sempre validar também o fluxo de tela de caso (`caso-form`) para manter paridade funcional entre os dois pontos de edição.
