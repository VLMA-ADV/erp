-- Z-8 / RF-082: edge list-contratos-inbox-mensagens lê contracts.solicitacoes_contrato via service_role.
-- Em DEV a tabela só tinha privilégios para postgres; PostgREST retornava "permission denied".
-- Idempotente: GRANT repetido é seguro.

GRANT SELECT ON TABLE contracts.solicitacoes_contrato TO service_role;
GRANT SELECT ON TABLE contracts.solicitacoes_contrato TO authenticated;
