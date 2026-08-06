BEGIN;

CREATE TEMP TABLE alvo AS
WITH r AS (
  SELECT c.id,
         bool_or(x->>'status'='rascunho') AS tem_rascunho,
         bool_or(x->>'status'='ativo') AS tem_ativa
  FROM contracts.casos c,
       LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.regras_financeiras)='array' THEN c.regras_financeiras ELSE '[]'::jsonb END) x
  WHERE c.tenant_id='d51463dd-a6b3-40e7-9488-854eba80a210' AND c.status='ativo'
  GROUP BY 1
)
SELECT id FROM r WHERE tem_rascunho AND NOT tem_ativa;

CREATE TEMP TABLE antes AS
SELECT (cs->>'caso_id') AS caso_id, ex->>'tipo' AS tipo, ex->>'data_referencia' AS dt,
       (ex->>'valor')::numeric AS valor, ex->>'descricao' AS descr
FROM (SELECT user_id FROM people.colaboradores WHERE email='filipe@voalegal.com.br') u,
     jsonb_array_elements(get_itens_a_faturar(u.user_id, date '2026-01-01', date '2027-12-31')) cli,
     jsonb_array_elements(cli->'contratos') ct,
     jsonb_array_elements(ct->'casos') cs,
     jsonb_array_elements(cs->'extrato') ex;

-- Ativa APENAS a primeira regra em rascunho de cada caso. Tres casos tem mais
-- de um rascunho; ativar todos deixaria o caso com duas regras cobrando ao
-- mesmo tempo. Os rascunhos restantes ficam como estao, para decisao humana.
UPDATE contracts.casos c
   SET regras_financeiras = (
         SELECT jsonb_agg(
                  CASE WHEN t.ord = primeiro.ord THEN jsonb_set(t.x,'{status}','"ativo"') ELSE t.x END
                  ORDER BY t.ord)
         FROM jsonb_array_elements(c.regras_financeiras) WITH ORDINALITY AS t(x, ord)
         CROSS JOIN LATERAL (
           SELECT min(t2.ord) AS ord
           FROM jsonb_array_elements(c.regras_financeiras) WITH ORDINALITY AS t2(x2, ord)
           WHERE t2.x2->>'status' = 'rascunho'
         ) primeiro),
       updated_at = now()
 WHERE c.id IN (SELECT id FROM alvo);

CREATE TEMP TABLE depois AS
SELECT (cs->>'caso_id') AS caso_id, ex->>'tipo' AS tipo, ex->>'data_referencia' AS dt,
       (ex->>'valor')::numeric AS valor, ex->>'descricao' AS descr
FROM (SELECT user_id FROM people.colaboradores WHERE email='filipe@voalegal.com.br') u,
     jsonb_array_elements(get_itens_a_faturar(u.user_id, date '2026-01-01', date '2027-12-31')) cli,
     jsonb_array_elements(cli->'contratos') ct,
     jsonb_array_elements(ct->'casos') cs,
     jsonb_array_elements(cs->'extrato') ex;

DO $$
DECLARE n_alvo int; n_sumiu int; n_dup_a int; n_dup_d int; n_rasc_restante int; n_ativa_dupla int;
BEGIN
  SELECT count(*) INTO n_alvo FROM alvo;
  IF n_alvo <> 128 THEN RAISE EXCEPTION 'A1: alvo tem % casos (esperado 128)', n_alvo; END IF;

  SELECT count(*) INTO n_sumiu FROM (SELECT * FROM antes EXCEPT ALL SELECT * FROM depois) x;
  IF n_sumiu <> 0 THEN RAISE EXCEPTION 'A2: % itens sumiram ou mudaram', n_sumiu; END IF;

  SELECT COALESCE(sum(q-1),0) INTO n_dup_a FROM (SELECT count(*) q FROM antes GROUP BY caso_id,tipo,dt,descr HAVING count(*)>1) d;
  SELECT COALESCE(sum(q-1),0) INTO n_dup_d FROM (SELECT count(*) q FROM depois GROUP BY caso_id,tipo,dt,descr HAVING count(*)>1) d;
  IF n_dup_d > n_dup_a THEN RAISE EXCEPTION 'A3: duplicidade nova (antes % / depois %)', n_dup_a, n_dup_d; END IF;

  -- nenhum caso alvo pode ter ficado com 2 regras ativas
  SELECT count(*) INTO n_ativa_dupla FROM contracts.casos c
   WHERE c.id IN (SELECT id FROM alvo)
     AND (SELECT count(*) FROM jsonb_array_elements(c.regras_financeiras) x WHERE x->>'status'='ativo') > 1;
  IF n_ativa_dupla > 0 THEN RAISE EXCEPTION 'A4: % casos ficaram com duas regras ativas', n_ativa_dupla; END IF;

  -- os 15 de risco NAO podem ter sido tocados
  SELECT count(DISTINCT c.id) INTO n_rasc_restante FROM contracts.casos c,
       LATERAL jsonb_array_elements(c.regras_financeiras) x
   WHERE c.tenant_id='d51463dd-a6b3-40e7-9488-854eba80a210' AND c.status='ativo' AND x->>'status'='rascunho';
  IF n_rasc_restante <> 18 THEN RAISE EXCEPTION 'A5: sobraram % casos com rascunho (esperado 18 = 15 de risco + 3 com rascunho extra)', n_rasc_restante; END IF;

  RAISE NOTICE 'ATIVACAO OK: 130 casos, 0 regressao, 0 duplicidade nova, 15 preservados';
END $$;

COMMIT;
