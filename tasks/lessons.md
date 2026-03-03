# Lessons Learned

- Ao implementar fluxo paralelo ao de "casos", preservar compatibilidade do payload legado e sincronizar estado local com o card ativo para evitar perda de dados ao trocar contexto.
- Em estruturas JSON de regras financeiras, nunca embutir `regras_cobranca` dentro de cada `regra_cobranca_config`; sempre sanitizar para evitar aninhamento recursivo e `Maximum call stack size exceeded`.

- Na revisão de faturamento por timesheet, manter `horas iniciais` como baseline imutável e permitir CRUD completo das linhas (adicionar/remover/editar data, profissional, atividade, valor/hora e horas revisadas), calculando totais a partir das linhas revisadas.

- No modal de revisão de fatura, evitar abas genéricas: renderizar UI contextual por tipo de item e para regras financeiras usar tabela de itens/parcelas (não campos soltos), preservando coerência com mensalidade/projeto/êxito.
- Quando a revisão for em modo `timesheet` sobre item de regra financeira, nunca persistir horas/valor no item de regra: materializar/atualizar `operations.timesheets` e `finance.billing_items` de origem `timesheet`, com auditoria explícita por usuário.
- Em totais de faturamento/revisão, nunca usar fallback com `||` para horas/valores; usar `nullish` para preservar `0` revisado/aprovado e evitar divergência entre telas.
- Na RPC `get_revisao_fatura`, horas (`informadas/revisadas/aprovadas`) devem ser forçadas a zero para `origem_tipo <> 'timesheet'` para impedir vazamento de horas em itens de regra financeira.
- Em faturamento/revisão, cálculo de `valor em aberto` deve usar precedência `valor_aprovado -> valor_revisado -> valor_informado`; usar apenas revisado/informado gera divergência após aprovação.
