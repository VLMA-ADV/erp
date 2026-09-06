-- =====================================================================
-- resolver_valor_hora devolve 0 em caso de regra mensal
--
-- Filipe, 06/09, caso 319 (PBIM) de novo: "alterei a regra de cobranca para
-- mensal mas as horas lancadas pelas equipes ainda estao sendo
-- contabilizadas, entao ta dando essa fatura alta" — R$ 142.836,88 na tela.
--
-- O banco ja estava certo: os 129 itens de hora valem 0 (20260903230000 e
-- 20260903234000). O que mostra 142 mil e a TELA de revisao, que para item
-- pendente recalcula valor = horas x valor_hora_atual (PR #208, "valor/hora
-- vigente da regra") — e valor_hora_atual vem de resolver_valor_hora, que
-- continuava respondendo 406,70 porque so olha a tabela de preco, nao a
-- regra de cobranca. Do lado de fora parecia que a correcao nao tinha pego.
--
-- Corrigir na origem: hora em caso com regra mensal (sem cobrar excedente)
-- vale 0 por hora. E a MESMA condicao da fila e do gerador; agora os tres
-- pontos concordam e a tela para de inventar valor.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolver_valor_hora(p_caso_id uuid, p_cargo_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH r AS (
    SELECT
      CASE
        WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
             AND jsonb_array_length(cs.regras_financeiras) > 0
          THEN cs.regras_financeiras->0
        ELSE NULL
      END AS x,
      cs.regra_cobranca,
      cs.regra_cobranca_config
    FROM contracts.casos cs
    WHERE cs.id = p_caso_id
  ),
  cfg AS (
    SELECT
      COALESCE(NULLIF(r.x->>'regra_cobranca', ''), r.regra_cobranca, '') AS regra,
      COALESCE(r.x->'regra_cobranca_config', r.regra_cobranca_config, '{}'::jsonb) AS c
    FROM r
  )
  SELECT CASE
    -- Regra mensal sem excedente: a hora e registro de trabalho, nao cobranca.
    WHEN (SELECT regra FROM cfg) IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     AND COALESCE(((SELECT c FROM cfg)->>'cobra_excedente')::boolean, false) = false
    THEN 0
    ELSE COALESCE(
      -- 1. tabela de preco por cargo
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
      -- 3. senao, NULL
    )
  END;
$$;
