-- =====================================================================
-- Postergar DESPESA, do mesmo jeito que a hora (Filipe, 16/10: "não deixa
-- postergar despesa" — Álvaro R$ 14,97, Gizeli, Fluvia, Osmar).
--
-- Até aqui só existiam postergar_timesheet (hora) e postergar_item_regra
-- (mensalidade/projeto/parcela). A despesa caía no meio: na fila o botão
-- sumia, e na revisão a tela chamava postergar_timesheet com timesheet_id
-- nulo. Só que a despesa já tem o mesmo campo da hora —
-- operations.despesas.periodo_faturamento (20260901180000), lido pela fila
-- (get_fila_por_competencia) e pelo gerador (start_faturamento_despesas_
-- fallback) — então postergar é gravar esse campo, como na hora.
--
-- Diferença para a hora: a fila de despesas só mostra status 'em_lancamento'
-- e o gerador passa a despesa para 'revisao' ao liberar. Postergando da
-- revisão, a despesa precisa voltar a 'em_lancamento', senão some da fila do
-- mês de destino (o mesmo buraco que o reset tinha em 01/09).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.postergar_despesa(p_user_id uuid, p_despesa_id uuid, p_periodo date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_bi finance.billing_items%ROWTYPE;
  v_cancelou boolean := false;
BEGIN
  -- Quem chama pelo PostgREST é o próprio usuário logado; p_user_id só vale
  -- para chamadas de serviço (mesmo arranjo de get_faturamento_postergados).
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Mesmas permissões de postergar_timesheet.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.write','finance.faturamento.manage',
                               'finance.faturamento.review','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para postergar lançamento';
  END IF;

  IF p_periodo IS NULL THEN RAISE EXCEPTION 'Novo período é obrigatório'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM operations.despesas d
    WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id AND d.apagado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  -- Já virou billing_item (postergando da revisão/aprovação, não da fila):
  -- sai da fatura atual, senão conta agora E de novo no mês de destino.
  SELECT * INTO v_bi FROM finance.billing_items bi
  WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'despesa'
    AND bi.origem_id = p_despesa_id AND bi.status <> 'cancelado';

  IF FOUND THEN
    IF v_bi.status = 'faturado' THEN
      RAISE EXCEPTION 'Despesa já faturada não pode ser postergada';
    END IF;
    UPDATE finance.billing_items
    SET status = 'cancelado', grupo_id = NULL, updated_at = now(), updated_by = p_user_id
    WHERE id = v_bi.id;
    v_cancelou := true;
  END IF;

  -- O cancelamento acima dispara finance.sync_despesa_status_from_billing_item,
  -- que marca a despesa como 'cancelado'. Aqui ela não foi cancelada, foi
  -- adiada: volta para 'em_lancamento' e reaparece na fila do mês escolhido.
  UPDATE operations.despesas
  SET periodo_faturamento = date_trunc('month', p_periodo)::date,
      status = CASE WHEN v_cancelou OR status IN ('revisao', 'aprovado') THEN 'em_lancamento' ELSE status END,
      updated_at = now(), updated_by = p_user_id
  WHERE id = p_despesa_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_despesa_id, 'periodo_faturamento', date_trunc('month', p_periodo)::date);
END;
$function$;

REVOKE ALL ON FUNCTION public.postergar_despesa(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.postergar_despesa(uuid, uuid, date) TO authenticated, service_role;

-- Aba "Postergados": a despesa adiada aparece junto com a hora adiada.
-- Mesmo critério da hora: competência acima do padrão (mês seguinte ao gasto).
CREATE OR REPLACE FUNCTION public.get_faturamento_postergados(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.periodo_novo, x.cliente_nome)
    FROM (
      -- 1. Itens de regra (mensalidade, projeto, parcela)
      SELECT a.id, 'regra'::text AS fonte, a.item_tipo, a.descricao, a.valor,
             a.competencia, a.periodo_novo, a.motivo,
             cs.numero AS caso_numero, cs.nome AS caso_nome,
             cl.nome AS cliente_nome, a.created_at
      FROM finance.faturamento_adiamentos a
      LEFT JOIN contracts.casos cs ON cs.id = a.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE a.tenant_id = v_tenant_id AND a.desfeito_em IS NULL

      UNION ALL

      -- 2. Horas adiadas — moram em outro lugar (periodo_faturamento do
      --    timesheet), mas para quem olha a tela são a mesma coisa.
      SELECT t.id, 'hora'::text, 'timesheet',
             COALESCE(NULLIF(t.descricao, ''), 'Horas') ,
             (t.horas * COALESCE(public.resolver_valor_hora(t.caso_id, t.cargo_id), 0))::numeric(14,2),
             (date_trunc('month', t.data_lancamento) + interval '1 month')::date,
             t.periodo_faturamento,
             NULL,
             cs.numero, cs.nome, cl.nome, t.updated_at
      FROM operations.timesheets t
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id
        AND t.periodo_faturamento IS NOT NULL
        AND date_trunc('month', t.periodo_faturamento)::date > (date_trunc('month', t.data_lancamento) + interval '1 month')::date
        -- periodo_faturamento veio da restauração da lixeira, não de um
        -- adiamento (o trigger limpa o marcador se alguém postergar depois).
        AND t.restaurado_da_lixeira_em IS NULL
        AND t.apagado_em IS NULL

      UNION ALL

      -- 3. Despesas adiadas (postergar_despesa, Filipe 16/10): mesmo campo e
      --    mesmo critério da hora.
      SELECT d.id, 'despesa'::text, 'despesa',
             COALESCE(NULLIF(btrim(d.descricao), ''), 'Despesa'),
             COALESCE(d.valor, 0)::numeric(14,2),
             (date_trunc('month', d.data_lancamento) + interval '1 month')::date,
             d.periodo_faturamento,
             NULL,
             cs.numero, cs.nome, cl.nome, d.updated_at
      FROM operations.despesas d
      LEFT JOIN contracts.casos cs ON cs.id = d.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = d.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE d.tenant_id = v_tenant_id
        AND d.periodo_faturamento IS NOT NULL
        AND date_trunc('month', d.periodo_faturamento)::date > (date_trunc('month', d.data_lancamento) + interval '1 month')::date
        AND d.apagado_em IS NULL
        -- já cobrada: não está mais "empurrada para frente"
        AND NOT EXISTS (
          SELECT 1 FROM finance.billing_items bi
          WHERE bi.tenant_id = d.tenant_id AND bi.origem_tipo = 'despesa'
            AND bi.origem_id = d.id AND bi.status = 'faturado'
        )
    ) x
  ), '[]'::jsonb);
END;
$function$;
