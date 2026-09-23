-- Caso 442 (Arpoador, 23/09): tres lancamentos de 20min aprovados a R$ 0,00.
-- Nasceram em 01-02/09 antes da tabela de preco por cargo ser preenchida, e o
-- recalculo ao salvar a regra nao os pegou como deveria: a funcao usava
-- resolver_valor_hora(caso, NULL) - um valor so para o caso inteiro -, o que
-- ignora a tabela por cargo (Administrativo R$ 239 vs Pleno R$ 478).
-- Agora cada item usa o cargo do proprio timesheet. Itens de regra mensal com
-- teto (resolver devolve NULL) ficam como estao - o preco deles e do periodo.
CREATE OR REPLACE FUNCTION finance.recalcular_valores_hora_do_caso(p_caso_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'operations', 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  UPDATE finance.billing_items bi
     SET valor_informado = ROUND(COALESCE(bi.horas_informadas, 0) * n.vh, 2),
         valor_revisado  = CASE WHEN bi.horas_revisadas IS NULL THEN bi.valor_revisado
                                ELSE ROUND(bi.horas_revisadas * n.vh, 2) END,
         valor_aprovado  = CASE WHEN bi.horas_aprovadas IS NULL THEN bi.valor_aprovado
                                ELSE ROUND(bi.horas_aprovadas * n.vh, 2) END,
         snapshot = CASE WHEN bi.snapshot ? 'valor_hora'
                         THEN jsonb_set(bi.snapshot, '{valor_hora}', to_jsonb(n.vh))
                         ELSE bi.snapshot END,
         updated_at = now()
    FROM (
      SELECT b.id,
             COALESCE(public.resolver_valor_hora(b.caso_id, t.cargo_id), 0) AS vh,
             public.resolver_valor_hora(b.caso_id, t.cargo_id) AS vh_bruto
        FROM finance.billing_items b
        LEFT JOIN operations.timesheets t ON t.id = b.origem_id
       WHERE b.caso_id = p_caso_id
         AND b.origem_tipo = 'timesheet'
    ) n
   WHERE n.id = bi.id
     AND n.vh_bruto IS NOT NULL
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
         <> ROUND(COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0) * n.vh, 2);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

-- Corrige o caso 442 agora.
SELECT finance.recalcular_valores_hora_do_caso(id) FROM contracts.casos WHERE numero = 442;
