-- Expõe schema finance ao PostgREST para que emit-nfse possa acessar
-- finance.billing_items e finance.billing_notes via supabase-js (schema routing)
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, contracts, finance';
NOTIFY pgrst, 'reload config';
