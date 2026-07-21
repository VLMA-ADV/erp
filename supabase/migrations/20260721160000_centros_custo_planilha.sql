-- Centros de custo da planilha (aba 3) — dimensão oficial do plano de contas.
-- Aditivo: os 7 CCs antigos continuam ativos até o financeiro validar o de-para.
ALTER TABLE finance.centros_custo ADD COLUMN IF NOT EXISTS codigo text;
CREATE UNIQUE INDEX IF NOT EXISTS centros_custo_tenant_codigo_uk
  ON finance.centros_custo (tenant_id, codigo) WHERE codigo IS NOT NULL;

INSERT INTO finance.centros_custo (tenant_id, nome, codigo, ativo)
SELECT 'd51463dd-a6b3-40e7-9488-854eba80a210'::uuid, v.nome, v.codigo, true
FROM (VALUES
  ('CC-100', 'Diretoria / Sócios'),
  ('CC-110', 'Jurídico - Contencioso Cível'),
  ('CC-120', 'Jurídico - Agro'),
  ('CC-130', 'Jurídico - Contratos'),
  ('CC-140', 'Jurídico - Societário'),
  ('CC-150', 'Jurídico - Trabalhista'),
  ('CC-160', 'Jurídico - Tributário'),
  ('CC-200', 'Comercial / Prospecção'),
  ('CC-500', 'Tecnologia da Informação'),
  ('CC-700', 'Tributos Corporativos'),
  ('CC-900', 'Corporativo / Administrativo')
) AS v(codigo, nome)
ON CONFLICT (tenant_id, codigo) WHERE codigo IS NOT NULL DO UPDATE SET nome = EXCLUDED.nome, ativo = true;
