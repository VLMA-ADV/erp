-- =====================================================================
-- Competências abertas: as abas da revisão (3/3 da fila dentro da revisão)
--
-- A revisão passa a ter uma aba por competência (mês de faturamento). Uma
-- aba existe quando o mês tem item pendente (em_revisao | em_aprovacao |
-- aprovado) OU fila não vazia, mais o mês corrente e o seguinte — sempre,
-- mesmo zerados, para "Gerar faturamento do mês" ter onde cair.
--
-- get_competencias_abertas(p_user_id) devolve, em ordem decrescente:
--   { competencia: 'YYYY-MM-01', pendentes, na_fila, valor_pendente, valor_na_fila }
--
-- Reusa as duas funções que a tela já chama, em vez de refazer o escopo:
--   - pendentes: get_revisao_fatura (todos os itens visíveis ao usuário,
--     agrupados pela competencia que ela passou a devolver em 20260922100000)
--   - na_fila: get_fila_por_competencia para o mês corrente e o seguinte.
--     Só esses dois: a fila é calculada ao vivo e varrer o passado custaria
--     uma get_itens_a_faturar por mês. Fila de mês antigo, se existir, é
--     hora esquecida — e aparece ao abrir a aba do mês pendente (a tela
--     chama a fila da aba aberta).
-- valor_pendente usa o valor mais avançado do item (aprovado > revisado >
-- informado), que é o que a revisão mostra.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_competencias_abertas(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_mes_atual date := date_trunc('month', CURRENT_DATE)::date;
  v_mes_seguinte date := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
  v_pendentes jsonb;
  v_fila_atual jsonb;
  v_fila_seguinte jsonb;
BEGIN
  -- Tenant, permissão e escopo são checados dentro delas (mesmas exceções).
  v_pendentes := public.get_revisao_fatura(p_user_id);
  v_fila_atual := public.get_fila_por_competencia(p_user_id, v_mes_atual);
  v_fila_seguinte := public.get_fila_por_competencia(p_user_id, v_mes_seguinte);

  RETURN (
    WITH pend AS (
      SELECT
        NULLIF(e->>'competencia', '')::date AS competencia,
        count(*)::int AS n,
        COALESCE(SUM(COALESCE(
          NULLIF(e->>'valor_aprovado', '')::numeric,
          NULLIF(e->>'valor_revisado', '')::numeric,
          NULLIF(e->>'valor_informado', '')::numeric,
          0
        )), 0)::numeric(14,2) AS valor
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_pendentes) = 'array' THEN v_pendentes ELSE '[]'::jsonb END
      ) e
      WHERE e->>'status' IN ('em_revisao', 'em_aprovacao', 'aprovado')
        AND NULLIF(e->>'competencia', '') IS NOT NULL
      GROUP BY 1
    ),
    fila AS (
      SELECT
        f.competencia,
        count(e.value)::int AS n,
        COALESCE(SUM(NULLIF(e.value->>'valor_informado', '')::numeric), 0)::numeric(14,2) AS valor
      FROM (
        VALUES
          (v_mes_atual, v_fila_atual),
          (v_mes_seguinte, v_fila_seguinte)
      ) AS f(competencia, itens)
      LEFT JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(f.itens) = 'array' THEN f.itens ELSE '[]'::jsonb END
      ) e ON true
      GROUP BY f.competencia
    ),
    meses AS (
      SELECT competencia FROM pend
      UNION
      SELECT competencia FROM fila WHERE n > 0
      UNION
      SELECT v_mes_atual
      UNION
      SELECT v_mes_seguinte
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'competencia', m.competencia,
          'pendentes', COALESCE(p.n, 0),
          'na_fila', COALESCE(f.n, 0),
          'valor_pendente', COALESCE(p.valor, 0),
          'valor_na_fila', COALESCE(f.valor, 0)
        )
        ORDER BY m.competencia DESC
      ),
      '[]'::jsonb
    )
    FROM meses m
    LEFT JOIN pend p ON p.competencia = m.competencia
    LEFT JOIN fila f ON f.competencia = m.competencia
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_competencias_abertas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competencias_abertas(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
