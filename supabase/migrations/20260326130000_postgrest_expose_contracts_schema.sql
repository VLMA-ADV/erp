-- Expõe o schema contracts ao PostgREST (pgrst.db_schemas).
-- Necessário para Edge Functions que usam supabase-js com .schema('contracts') sobre REST
-- (ex.: delete-anexo com service role após checagem de tenant).
-- Sem isso: PGRST106 "Invalid schema: contracts".

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, contracts';
NOTIFY pgrst, 'reload schema';
