-- Remove a flag morta `usa_tabela_preco` das configs de regra.
--
-- Quem decide o modo de cobrança por hora é `modo_preco` ('valor_hora' |
-- 'tabela'), e ele está correto em todos os casos. `usa_tabela_preco` nunca
-- chegou a ser escrito pelo formulário: ficava gravado como false mesmo em
-- caso com tabela preenchida, sugerindo um desligamento que não existia.
UPDATE contracts.casos
SET regra_cobranca_config = regra_cobranca_config - 'usa_tabela_preco'
WHERE regra_cobranca_config ? 'usa_tabela_preco';

UPDATE contracts.casos
SET regras_financeiras = (
  SELECT jsonb_agg(
    CASE
      WHEN r->'regra_cobranca_config' ? 'usa_tabela_preco'
        THEN jsonb_set(r, '{regra_cobranca_config}',
                       (r->'regra_cobranca_config') - 'usa_tabela_preco')
      ELSE r
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(regras_financeiras) WITH ORDINALITY AS t(r, ord)
)
WHERE jsonb_typeof(regras_financeiras) = 'array'
  AND jsonb_array_length(regras_financeiras) > 0
  AND regras_financeiras::text LIKE '%usa_tabela_preco%';
