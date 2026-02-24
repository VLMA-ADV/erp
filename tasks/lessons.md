# Lessons Learned

- Ao implementar fluxo paralelo ao de "casos", preservar compatibilidade do payload legado e sincronizar estado local com o card ativo para evitar perda de dados ao trocar contexto.
- Em estruturas JSON de regras financeiras, nunca embutir `regras_cobranca` dentro de cada `regra_cobranca_config`; sempre sanitizar para evitar aninhamento recursivo e `Maximum call stack size exceeded`.
