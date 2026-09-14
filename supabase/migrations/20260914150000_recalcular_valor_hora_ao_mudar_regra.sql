-- =====================================================================
-- Mudou a regra de cobranca do caso? Recalcula os itens ainda nao faturados
--
-- Filipe, 14/09, caso 1950 (Dall'Orto): "a regra de cobranca do caso esta
-- com hora a 550 mas ele nao ta contabilizando as horas totais ali em cima,
-- so no individual. ai nao consigo faturar".
--
-- O que acontecia: os itens nasceram em 01/09, quando o caso ainda nao tinha
-- valor/hora, e foram gravados com valor 0. Hoje as 14:54 ele colocou 550.
-- A TELA recalcula item pendente com o valor/hora vigente (#208/#384), mas
-- item ja aprovado fica congelado (#385, proposital) — e o banco, que e o
-- que a NFS-e le, seguia com 0. Dai o cabecalho somar R$ 572 e a emissao
-- sair errada.
--
-- Agora, ao salvar a regra do caso, os itens ainda nao faturados sao
-- recalculados. Nao toca em item faturado/cancelado/ignorado (historico), e
-- nao sobrescreve valor que alguem editou na mao: so recalcula o que ainda
-- estava em zero ou o que batia exatamente com horas x valor/hora anterior.
-- Regra mensal continua zerando a hora, porque resolver_valor_hora devolve 0
-- nesse caso (#383) — mesmo comportamento da fila e do gerador.
-- =====================================================================
CREATE OR REPLACE FUNCTION finance.recalcular_valores_hora_do_caso(p_caso_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'public'
AS $$
DECLARE
  v_novo numeric;
  v_n integer := 0;
BEGIN
  v_novo := COALESCE(public.resolver_valor_hora(p_caso_id, NULL), 0);

  UPDATE finance.billing_items bi
     SET valor_informado = ROUND(COALESCE(bi.horas_informadas, 0) * v_novo, 2),
         valor_revisado  = CASE WHEN bi.horas_revisadas IS NULL THEN bi.valor_revisado
                                ELSE ROUND(bi.horas_revisadas * v_novo, 2) END,
         valor_aprovado  = CASE WHEN bi.horas_aprovadas IS NULL THEN bi.valor_aprovado
                                ELSE ROUND(bi.horas_aprovadas * v_novo, 2) END,
         snapshot = CASE WHEN bi.snapshot ? 'valor_hora'
                         THEN jsonb_set(bi.snapshot, '{valor_hora}', to_jsonb(v_novo))
                         ELSE bi.snapshot END,
         updated_at = now()
   WHERE bi.caso_id = p_caso_id
     AND bi.origem_tipo = 'timesheet'
     AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado')
     -- Nao sobrescreve valor editado na mao: so o que estava zerado ou o que
     -- era exatamente horas x valor/hora anterior (calculo da maquina).
     AND (
       COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) = 0
       OR COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)
          = ROUND(COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0)
                  * COALESCE(NULLIF(bi.snapshot->>'valor_hora','')::numeric, 0), 2)
     )
     -- Nada a fazer se o valor ja esta certo.
     AND COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)
         <> ROUND(COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0) * v_novo, 2);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION contracts.trg_caso_regra_recalcula_itens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'contracts', 'finance', 'public'
AS $$
BEGIN
  PERFORM finance.recalcular_valores_hora_do_caso(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_caso_regra_recalcula_itens ON contracts.casos;
CREATE TRIGGER trg_caso_regra_recalcula_itens
AFTER UPDATE OF regra_cobranca, regra_cobranca_config, regras_financeiras ON contracts.casos
FOR EACH ROW
WHEN (
  NEW.regra_cobranca IS DISTINCT FROM OLD.regra_cobranca
  OR NEW.regra_cobranca_config IS DISTINCT FROM OLD.regra_cobranca_config
  OR NEW.regras_financeiras IS DISTINCT FROM OLD.regras_financeiras
)
EXECUTE FUNCTION contracts.trg_caso_regra_recalcula_itens();

-- Acerto do que ja esta na base: 9 itens em 3 casos, aprovados com valor 0
-- num caso por hora que tem valor/hora definido (o 1950 e mais dois).
DO $$
DECLARE r record; v_total int := 0; v_n int;
BEGIN
  FOR r IN
    SELECT DISTINCT bi.caso_id
    FROM finance.billing_items bi
    JOIN contracts.casos cs ON cs.id = bi.caso_id
    WHERE bi.origem_tipo = 'timesheet'
      AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado')
      AND COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) = 0
      AND COALESCE(public.resolver_valor_hora(cs.id, NULL), 0) > 0
  LOOP
    v_n := finance.recalcular_valores_hora_do_caso(r.caso_id);
    v_total := v_total + v_n;
  END LOOP;
  RAISE NOTICE 'itens recalculados: %', v_total;
END $$;
