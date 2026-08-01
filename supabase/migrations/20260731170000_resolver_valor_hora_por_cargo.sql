-- Resolve o valor/hora de um caso considerando a TABELA DE PREÇO POR CARGO.
--
-- Até aqui a tabela de preço era coletada no formulário, gravada no jsonb da
-- regra e nunca lida por ninguém: o motor usava só o `valor_hora` avulso e,
-- quando ele vinha vazio (que é o caso de quem usa tabela), caía em zero
-- silenciosamente. Resultado: 7 casos faturando R$ 0,00.
--
-- Esta função passa a ser o ÚNICO lugar que decide o valor/hora. Todos os
-- pontos que hoje repetem a conta vão chamá-la.
--
-- Ordem de resolução:
--   1. linha da tabela de preço para o cargo informado (quando houver);
--   2. valor_hora avulso da regra (comportamento atual, preservado);
--   3. NULL — sem preço definido. NULL é diferente de zero de propósito:
--      quem chama decide se recusa a operação ou apenas não exibe valor.
CREATE OR REPLACE FUNCTION public.resolver_valor_hora(
  p_caso_id  uuid,
  p_cargo_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'contracts'
AS $function$
  WITH cfg AS (
    -- Mesma escolha de regra já usada em get_itens_a_faturar/start_faturamento_flow:
    -- caso multi-regra usa a primeira de regras_financeiras; senão o config do caso.
    SELECT CASE
             WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                  AND jsonb_array_length(cs.regras_financeiras) > 0
               THEN cs.regras_financeiras->0->'regra_cobranca_config'
             ELSE cs.regra_cobranca_config
           END AS c
    FROM contracts.casos cs
    WHERE cs.id = p_caso_id
  )
  SELECT COALESCE(
    -- 1. tabela de preço por cargo
    (
      SELECT NULLIF(i->>'valor_hora', '')::numeric
      FROM cfg, LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(cfg.c->'tabela_preco_itens') = 'array'
                  THEN cfg.c->'tabela_preco_itens' ELSE '[]'::jsonb END
           ) i
      WHERE p_cargo_id IS NOT NULL
        AND i->>'cargo_id' = p_cargo_id::text
        AND COALESCE(NULLIF(i->>'valor_hora', '')::numeric, 0) > 0
      LIMIT 1
    ),
    -- 2. valor avulso da regra
    (SELECT NULLIF(cfg.c->>'valor_hora', '')::numeric FROM cfg)
    -- 3. senão, NULL
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_valor_hora(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_valor_hora(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolver_valor_hora(uuid, uuid) IS
  'Valor/hora do caso: tabela de preço por cargo > valor avulso > NULL (sem preço).';
