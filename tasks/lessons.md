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
- Quando o ambiente remoto estiver com drift de migrations em faturamento, usar fallback no frontend (merge de `get-despesas` em `itens-a-faturar`) para evitar sumiço de despesas na árvore enquanto a RPC consolidada não é aplicada.
- No fluxo de faturamento de despesas, garantir que `operations.despesas.cliente_id` esteja preenchido (backfill + create/update), pois as RPCs de elegibilidade usam esse vínculo e podem retornar “Nenhum item elegível” mesmo com despesa lançada.
- Em módulo de despesas, sempre expor e validar `valor` no frontend e nas RPCs (`get/create/update`), pois sem isso o item entra no faturamento com `R$ 0,00` e quebra a expectativa do fluxo.
- Em `itens-a-faturar`, evitar fallback local que injeta itens fora da elegibilidade oficial do backend; para compatibilidade entre versões de RPC, preferir envio por caso com `alvo_id` (sequencial) no lote selecionado.
- Em ambientes legados onde `get_itens_a_faturar` ainda não consolida despesas, manter fallback de leitura via `get-despesas` para visibilidade operacional, com deduplicação por `origem_id` e recálculo de totais no frontend.
- Regra de domínio: `Revisão de fatura` encerra no status aprovado; qualquer ação de faturar (linha ou lote) deve existir apenas em `Fluxo de faturamento` para evitar inconsistência de status e UX duplicada.
- Em ajustes de fluxo, remover apenas o botão principal não é suficiente: revisar toda a tabela hierárquica (cliente/contrato/caso/linha) para eliminar checkboxes residuais de seleção em massa.
- Em `Revisão de fatura`, linhas com status final (`aprovado`, `faturado`, `cancelado`) devem exibir ações como `-` para evitar edição/configuração após encerramento da etapa.
- Quando a tela possui regra de domínio fixa por etapa (ex.: revisão só com `em_revisao`/`em_aprovacao`), aplicar filtro local obrigatório no parse para blindar contra retornos amplos da API compartilhada.
