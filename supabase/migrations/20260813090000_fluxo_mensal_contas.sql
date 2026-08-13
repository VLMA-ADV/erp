-- Fluxo de caixa do mes, dia a dia (pedido Filipe 12/08, item 1 de Contas a
-- pagar e receber): barra de meses + grafico de linhas com TODOS os dias do
-- mes, vermelha para pagar e verde para receber, como ja e no Timesheet.
--
-- cp_rotina_diaria responde por UM dia. Aqui o mes inteiro vem somado por dia,
-- numa chamada so — 30 chamadas de cp_rotina_diaria seria lento e ainda daria
-- um numero diferente, porque ela mistura vencidos de outros meses na lista.
--
-- REGRA DO DIA EM QUE O DINHEIRO CONTA (cada lancamento conta exatamente uma
-- vez, senao o grafico mente):
--   * Ja baixado (pago/recebido) -> conta no dia da BAIXA, pelo valor baixado.
--     E quando o dinheiro se moveu de fato; pode diferir do vencimento.
--   * Ainda em aberto -> conta no dia do VENCIMENTO, pelo valor cheio.
--   * Cancelado -> nao conta nunca.
--
-- ATRASADOS: lancamento em aberto que venceu ANTES do mes apareceria fora da
-- janela e sumiria do grafico — mas ele ainda vai sair do caixa. Entao ele e
-- puxado para o dia 1 do mes (GREATEST abaixo) e devolvido tambem em
-- 'atrasado_anterior', para a tela poder avisar que aquele primeiro dia carrega
-- divida velha e nao e um dia normal.
--
-- SALDO INICIAL: so dinheiro que se moveu DE VERDADE antes do mes (saldo de
-- abertura das contas + baixas anteriores). Conta em aberto nao entra, porque
-- ninguem pagou nada ainda. Assim nada e contado duas vezes: o que ja baixou
-- antes do mes esta no saldo inicial, o que baixa ou vence dentro do mes esta
-- nos dias.
CREATE OR REPLACE FUNCTION public.cp_fluxo_mensal(p_user_id uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_mes_inicio date;
  v_mes_fim date;
  v_saldo_abertura numeric(14,2);
  v_baixas_antes numeric(14,2);
  v_saldo_inicial numeric(14,2);
  v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  v_mes_inicio := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_mes_fim := (v_mes_inicio + interval '1 month - 1 day')::date;

  SELECT COALESCE(SUM(cb.saldo_abertura), 0) INTO v_saldo_abertura
  FROM finance.contas_bancarias cb WHERE cb.tenant_id = v_tenant AND cb.ativo;

  SELECT COALESCE(SUM(
    CASE WHEN l.natureza = 'receber' THEN COALESCE(l.baixa_valor, l.valor)
         ELSE -COALESCE(l.baixa_valor, l.valor) END
  ), 0) INTO v_baixas_antes
  FROM finance.lancamentos l
  WHERE l.tenant_id = v_tenant
    AND l.status IN ('pago', 'recebido')
    AND COALESCE(l.baixa_data, l.vencimento) < v_mes_inicio;

  v_saldo_inicial := v_saldo_abertura + v_baixas_antes;

  WITH mov AS (
    SELECT
      l.natureza,
      l.status,
      CASE WHEN l.status IN ('pago', 'recebido') THEN COALESCE(l.baixa_data, l.vencimento)
           ELSE l.vencimento END AS data_real,
      CASE WHEN l.status IN ('pago', 'recebido') THEN COALESCE(l.baixa_valor, l.valor)
           ELSE l.valor END AS valor_real
    FROM finance.lancamentos l
    WHERE l.tenant_id = v_tenant
      AND l.status <> 'cancelado'
  ),
  no_mes AS (
    SELECT
      natureza,
      valor_real,
      -- Atrasado de mes anterior sobe para o dia 1; o resto fica no proprio dia.
      GREATEST(data_real, v_mes_inicio) AS dia,
      (data_real < v_mes_inicio) AS veio_atrasado
    FROM mov
    WHERE data_real <= v_mes_fim
      -- Baixado antes do mes ja esta no saldo inicial; em aberto sobe pro dia 1.
      AND (data_real >= v_mes_inicio OR status NOT IN ('pago', 'recebido'))
  ),
  dias AS (
    SELECT gs::date AS dia
    FROM generate_series(v_mes_inicio, v_mes_fim, interval '1 day') gs
  ),
  por_dia AS (
    SELECT
      d.dia,
      COALESCE(SUM(m.valor_real) FILTER (WHERE m.natureza = 'pagar'), 0)::numeric(14,2) AS pagar,
      COALESCE(SUM(m.valor_real) FILTER (WHERE m.natureza = 'receber'), 0)::numeric(14,2) AS receber
    FROM dias d
    LEFT JOIN no_mes m ON m.dia = d.dia
    GROUP BY d.dia
  ),
  acumulado AS (
    SELECT
      dia, pagar, receber,
      (v_saldo_inicial + SUM(receber - pagar) OVER (ORDER BY dia))::numeric(14,2) AS saldo_projetado
    FROM por_dia
  )
  SELECT jsonb_build_object(
    'mes_inicio', v_mes_inicio,
    'mes_fim', v_mes_fim,
    'saldo_inicial', v_saldo_inicial,
    'dias', COALESCE(jsonb_agg(
      jsonb_build_object(
        'data', dia,
        'pagar', pagar,
        'receber', receber,
        'saldo_projetado', saldo_projetado
      ) ORDER BY dia
    ), '[]'::jsonb),
    'total_pagar', COALESCE(SUM(pagar), 0),
    'total_receber', COALESCE(SUM(receber), 0),
    'saldo_final', COALESCE(
      (SELECT saldo_projetado FROM acumulado ORDER BY dia DESC LIMIT 1), v_saldo_inicial
    ),
    'atrasado_anterior', jsonb_build_object(
      'pagar', COALESCE((SELECT SUM(valor_real) FROM no_mes WHERE veio_atrasado AND natureza = 'pagar'), 0),
      'receber', COALESCE((SELECT SUM(valor_real) FROM no_mes WHERE veio_atrasado AND natureza = 'receber'), 0)
    )
  ) INTO v_out
  FROM acumulado;

  RETURN v_out;
END;
$function$;
