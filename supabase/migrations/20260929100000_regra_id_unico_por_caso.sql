-- Filipe, 29/09: "duplicate key value violates unique constraint
-- idx_billing_items_unique_regra_por_periodo" ao liberar outubro em massa.
--
-- Causa: caso criado como copia de outro leva junto o `id` de cada regra em
-- regras_financeiras. finance.rule_origin_uuid usa o id da regra como origem
-- do item quando ele ja e um uuid - sem olhar o caso. Duas copias viram a
-- MESMA regra para o faturamento: liberadas juntas, o banco recusa o lote; em
-- separado, a segunda nunca e cobrada (o item da primeira "ja existe").
-- Casos 1960 e 1979 (Gramarcal) em outubro; mais 9 grupos na mesma situacao.
--
-- Nao da para mudar rule_origin_uuid: todo item ja gerado perderia o vinculo
-- com a regra e seria cobrado de novo. O conserto e no cadastro: id de regra
-- e unico entre casos. O gatilho troca o id repetido por um novo no caso que
-- esta sendo gravado - desde que ele ainda nao tenha cobranca nem adiamento
-- com aquela origem (ai o dono do id e ele, e quem muda e o outro).
CREATE OR REPLACE FUNCTION contracts.casos_regra_id_unico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'contracts', 'finance', 'public'
AS $function$
DECLARE
  v_regra jsonb;
  v_novas jsonb := '[]'::jsonb;
  v_id text;
  v_mudou boolean := false;
BEGIN
  IF NEW.regras_financeiras IS NULL OR jsonb_typeof(NEW.regras_financeiras) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_regra IN SELECT x FROM jsonb_array_elements(NEW.regras_financeiras) WITH ORDINALITY AS t(x, ord) ORDER BY ord LOOP
    v_id := NULLIF(v_regra->>'id', '');
    IF v_id IS NOT NULL
       AND v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       AND EXISTS (
         SELECT 1
           FROM contracts.casos o,
                jsonb_array_elements(CASE WHEN jsonb_typeof(o.regras_financeiras) = 'array'
                                          THEN o.regras_financeiras ELSE '[]'::jsonb END) r
          WHERE o.tenant_id = NEW.tenant_id
            AND o.id <> NEW.id
            AND r->>'id' = v_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM finance.billing_items bi
          WHERE bi.caso_id = NEW.id
            AND bi.origem_tipo = 'regra_financeira'
            AND bi.origem_id = v_id::uuid
       )
       AND NOT EXISTS (
         SELECT 1 FROM finance.faturamento_adiamentos a WHERE a.caso_id = NEW.id
       )
    THEN
      v_regra := jsonb_set(v_regra, '{id}', to_jsonb(gen_random_uuid()::text));
      v_mudou := true;
    END IF;
    v_novas := v_novas || jsonb_build_array(v_regra);
  END LOOP;

  IF v_mudou THEN
    NEW.regras_financeiras := v_novas;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_casos_regra_id_unico ON contracts.casos;
CREATE TRIGGER trg_casos_regra_id_unico
  BEFORE INSERT OR UPDATE OF regras_financeiras ON contracts.casos
  FOR EACH ROW EXECUTE FUNCTION contracts.casos_regra_id_unico();

-- Conserta o que ja esta duplicado: em cada grupo o caso mais antigo fica com
-- o id; as copias passam pelo gatilho e ganham um id novo. Nenhum destes 21
-- casos tem item de regra gerado nem adiamento (conferido em 29/09).
UPDATE contracts.casos c
   SET regras_financeiras = c.regras_financeiras
 WHERE c.id IN (
   SELECT caso_id FROM (
     SELECT cs.id AS caso_id,
            row_number() OVER (PARTITION BY r->>'id' ORDER BY cs.created_at, cs.numero) AS ordem
       FROM contracts.casos cs,
            jsonb_array_elements(CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                                      THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
      WHERE (r->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   ) x WHERE ordem > 1
 );
