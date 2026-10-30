-- Lixeira do faturamento, etapa 3 (Filipe 30/10): itens IGNORADOS na revisão.
--
-- Bruna ignorou duas horas da Mariana Heusy (Achei, caso 376) e não havia
-- como desfazer: a lixeira só tinha hora excluída da fila e registro apagado.
-- Agora o item ignorado (billing_items.status = 'ignorado') aparece na
-- lixeira com quem ignorou, quando e o motivo, pelos mesmos 12 meses, e
-- restaurar o devolve à revisão do mês dele com o valor lançado. Mesma
-- permissão nominal de restaurar (finance.faturamento.lixeira.restore).

CREATE OR REPLACE FUNCTION public.get_lixeira_faturamento(p_user_id uuid, p_busca text DEFAULT NULL::text, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_pode_restaurar boolean := false;
  v_busca text := NULLIF(trim(COALESCE(p_busca, '')), '');
  v_mes date := date_trunc('month', p_mes)::date;
  v_limite timestamptz := now() - interval '12 months';
  v_itens jsonb;
BEGIN
  -- Em chamada autenticada vale a identidade do token (como get_user_permissions).
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT e.tenant_id, e.can_view_all, e.viewer_area_id
  INTO v_tenant_id, v_can_view_all, v_viewer_area_id
  FROM finance.escopo_faturamento(p_user_id) e;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Mesma lista de leitura de get_revisao_fatura: a lixeira mora na revisão.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read', 'finance.faturamento.review',
      'finance.faturamento.approve', 'finance.faturamento.manage',
      'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar revisão de fatura';
  END IF;

  v_pode_restaurar := finance._tem_permissao_nominal(p_user_id, 'finance.faturamento.lixeira.restore');
  -- Quem restaura enxerga a lixeira inteira, independente da área.
  v_can_view_all := v_can_view_all OR v_pode_restaurar;

  WITH fontes AS (
    -- Etapa 1: hora excluída da fila (e não apagada).
    SELECT 'excluido_fila'::text AS tipo, t.id, t.contrato_id, t.caso_id, t.created_by,
           t.data_lancamento::date AS data_lancamento, COALESCE(t.horas, 0)::numeric AS horas,
           NULL::numeric AS valor, NULL::text AS categoria, COALESCE(t.descricao, '') AS descricao,
           t.excluido_faturamento_por AS quem_id, t.excluido_faturamento_em AS quando,
           t.excluido_faturamento_motivo AS motivo,
           date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento::date))::date AS mes,
           'timesheet'::text AS origem
    FROM operations.timesheets t
    WHERE t.tenant_id = v_tenant_id
      AND t.apagado_em IS NULL
      AND t.excluido_faturamento
      AND t.excluido_faturamento_em >= v_limite
    UNION ALL
    -- Etapa 2: hora apagada na tela de Timesheet.
    SELECT 'timesheet_apagado', t.id, t.contrato_id, t.caso_id, t.created_by,
           t.data_lancamento::date, COALESCE(t.horas, 0)::numeric,
           NULL::numeric, NULL::text, COALESCE(t.descricao, ''),
           t.apagado_por, t.apagado_em, NULL::text,
           date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento::date))::date,
           'timesheet'
    FROM operations.timesheets t
    WHERE t.tenant_id = v_tenant_id
      AND t.apagado_em >= v_limite
    UNION ALL
    -- Etapa 2: despesa apagada na tela de Despesas.
    SELECT 'despesa_apagada', d.id, d.contrato_id, d.caso_id, d.created_by,
           d.data_lancamento::date, 0::numeric,
           COALESCE(d.valor, 0)::numeric, d.categoria::text, COALESCE(d.descricao, ''),
           d.apagado_por, d.apagado_em, NULL::text,
           date_trunc('month', COALESCE(d.periodo_faturamento, d.data_lancamento::date))::date,
           'despesa'
    FROM operations.despesas d
    WHERE d.tenant_id = v_tenant_id
      AND d.apagado_em >= v_limite
    UNION ALL
    -- Etapa 3 (Filipe 30/10): item IGNORADO na revisão (ignorar_billing_items).
    -- O id é o do item de cobrança; volta para a revisão do mês dele. Fica de
    -- fora o item cujo lançamento já tem outro item vivo (mensalidade gerada
    -- de novo, por exemplo): restaurar cobraria duas vezes.
    SELECT 'item_ignorado', bi.id, bi.contrato_id, bi.caso_id,
           COALESCE(t.created_by, d.created_by, bi.created_by),
           COALESCE(t.data_lancamento::date, d.data_lancamento::date, bi.data_referencia::date, bi.periodo_inicio),
           CASE WHEN bi.origem_tipo = 'timesheet'
                THEN COALESCE(bi.horas_revisadas, bi.horas_informadas, t.horas, 0) ELSE 0 END::numeric,
           COALESCE(bi.valor_informado, 0)::numeric,
           COALESCE(d.categoria::text, CASE WHEN bi.origem_tipo = 'regra_financeira' THEN 'Regra de cobrança' END),
           COALESCE(t.descricao, d.descricao, NULLIF(bi.snapshot->>'regra_nome', ''), NULLIF(bi.snapshot->>'descricao', ''),
                    NULLIF(bi.snapshot->>'regra_cobranca', ''), ''),
           NULLIF(bi.snapshot->>'ignorado_por', '')::uuid,
           COALESCE(NULLIF(bi.snapshot->>'ignorado_em', '')::timestamptz, bi.updated_at),
           NULLIF(bi.snapshot->>'motivo_ignorado', ''),
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date,
           bi.origem_tipo::text
    FROM finance.billing_items bi
    LEFT JOIN operations.timesheets t ON bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id
    LEFT JOIN operations.despesas d ON bi.origem_tipo = 'despesa' AND d.id = bi.origem_id
    WHERE bi.tenant_id = v_tenant_id
      AND bi.status = 'ignorado'
      AND COALESCE(NULLIF(bi.snapshot->>'ignorado_em', '')::timestamptz, bi.updated_at) >= v_limite
      AND t.apagado_em IS NULL AND d.apagado_em IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items o
        WHERE o.tenant_id = v_tenant_id AND o.origem_tipo = bi.origem_tipo AND o.origem_id = bi.origem_id
          AND o.id <> bi.id AND o.status NOT IN ('cancelado', 'ignorado')
      )
  )
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.quando DESC), '[]'::jsonb)
  INTO v_itens
  FROM (
    SELECT
      f.quando,
      jsonb_build_object(
        'tipo', f.tipo,
        'id', f.id,
        'chave', f.tipo || ':' || f.id::text,
        'timesheet_id', CASE WHEN f.tipo IN ('excluido_fila', 'timesheet_apagado') THEN f.id END,
        'despesa_id', CASE WHEN f.tipo = 'despesa_apagada' THEN f.id END,
        'billing_item_id', CASE WHEN f.tipo = 'item_ignorado' THEN f.id END,
        -- timesheet / despesa / regra_financeira: o que o item é (ignorado de qualquer origem).
        'origem_tipo', f.origem,
        'cliente_id', cli.id,
        'cliente_nome', cli.nome,
        'contrato_id', c.id,
        'contrato_numero', c.numero,
        -- Número canônico para exibir (20261009120000): filtros seguem em numero.
        'contrato_numero_sequencial', COALESCE(c.numero_sequencial, c.numero),
        'contrato_nome', c.nome_contrato,
        'contrato_ativo', c.status = 'ativo',
        'caso_id', cs.id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'caso_ativo', cs.status <> 'inativo',
        'profissional_nome', COALESCE(aut.nome, ''),
        'data_lancamento', f.data_lancamento,
        'horas', f.horas,
        'valor', f.valor,
        'categoria', f.categoria,
        'descricao', f.descricao,
        'excluido_por_id', f.quem_id,
        'excluido_por_nome', COALESCE(exc.nome, ''),
        'excluido_em', f.quando,
        'motivo', f.motivo,
        -- Competência em que estava quando saiu (regra da fila).
        'mes_original', f.mes,
        -- Para onde volta ao restaurar (mesma regra de restaurar_lixeira_faturamento).
        -- Ignorado volta para a revisão do próprio mês (o item já existe).
        'mes_destino', CASE WHEN f.tipo = 'item_ignorado' THEN f.mes
                            ELSE GREATEST(date_trunc('month', CURRENT_DATE)::date, f.mes) END,
        'expira_em', f.quando + interval '12 months',
        'dias_restantes', GREATEST(0, ceil(EXTRACT(EPOCH FROM (f.quando + interval '12 months' - now())) / 86400.0))::int,
        -- Aviso antes de restaurar: o mês original já tem kit (item
        -- aprovado/faturado do caso) e/ou NFS-e viva sobre ele. Mesma regra
        -- de competência e de NFS-e de excluir_kit.
        'kit_no_mes_original', kit.tem_kit,
        'nfse_no_mes_original', nf.nfse_numero
      ) AS item
    FROM fontes f
    JOIN contracts.contratos c ON c.id = f.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs ON cs.id = f.caso_id AND cs.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores aut ON aut.user_id = f.created_by AND aut.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores exc ON exc.user_id = f.quem_id AND exc.tenant_id = v_tenant_id
    LEFT JOIN LATERAL (
      SELECT array_agg(bi.id) AS ids, count(*) > 0 AS tem_kit
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.status IN ('aprovado', 'faturado')
        AND bi.contrato_id = f.contrato_id
        AND bi.caso_id IS NOT DISTINCT FROM f.caso_id
        AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = f.mes
    ) kit ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                      NULLIF(bn.metadata->>'nfse_numero', ''),
                      bn.numero::text) AS nfse_numero
      FROM finance.billing_notes bn
      WHERE kit.ids IS NOT NULL
        AND bn.tenant_id = v_tenant_id
        AND bn.tipo_documento = 'nota_fiscal_servico'
        AND bn.status = 'gerado'
        AND bn.focus_status IN ('autorizado', 'processando')
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) xi
          WHERE xi.value::uuid = ANY (kit.ids)
        )
      ORDER BY bn.created_at DESC
      LIMIT 1
    ) nf ON true
    WHERE (
        v_can_view_all
        OR aut.area_id = v_viewer_area_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      AND (v_mes IS NULL OR f.mes = v_mes)
      AND (
        v_busca IS NULL
        OR cli.nome ILIKE '%' || v_busca || '%'
        OR c.nome_contrato ILIKE '%' || v_busca || '%'
        OR cs.nome ILIKE '%' || v_busca || '%'
        OR c.numero::text ILIKE '%' || v_busca || '%'
        OR COALESCE(c.numero_sequencial, c.numero)::text ILIKE '%' || v_busca || '%'
        OR cs.numero::text ILIKE '%' || v_busca || '%'
        OR f.descricao ILIKE '%' || v_busca || '%'
        OR f.categoria ILIKE '%' || v_busca || '%'
        OR aut.nome ILIKE '%' || v_busca || '%'
      )
  ) x;

  RETURN jsonb_build_object(
    'pode_restaurar', v_pode_restaurar,
    'mes_destino', date_trunc('month', CURRENT_DATE)::date,
    'itens', v_itens
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.restaurar_lixeira_faturamento(uuid, uuid[], uuid[], uuid[]);
CREATE OR REPLACE FUNCTION public.restaurar_lixeira_faturamento(p_user_id uuid, p_excluidos uuid[] DEFAULT '{}'::uuid[], p_timesheets uuid[] DEFAULT '{}'::uuid[], p_despesas uuid[] DEFAULT '{}'::uuid[], p_ignorados uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_mes date := date_trunc('month', CURRENT_DATE)::date;
  v_limite timestamptz := now() - interval '12 months';
  v_exc jsonb := '{}'::jsonb;
  v_n_exc int := 0;
  v_n_ts int := 0;
  v_n_desp int := 0;
  v_n_ign int := 0;
  v_pedidos int := COALESCE(cardinality(p_excluidos), 0)
                 + COALESCE(cardinality(p_timesheets), 0)
                 + COALESCE(cardinality(p_despesas), 0)
                 + COALESCE(cardinality(p_ignorados), 0);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT finance._tem_permissao_nominal(p_user_id, 'finance.faturamento.lixeira.restore') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar lançamentos da lixeira do faturamento';
  END IF;

  IF COALESCE(cardinality(p_excluidos), 0) > 0 THEN
    v_exc := public.restaurar_timesheets_lixeira(p_user_id, p_excluidos);
    v_n_exc := COALESCE((v_exc->>'afetados')::int, 0);
  END IF;

  -- Timesheet apagado: volta como estava. Se não estava excluído da fila, vai
  -- para a fila pela regra da etapa 1 (mês original já passou -> mês corrente;
  -- futuro -> fica) com o marcador que tira de Postergados. Se estava
  -- excluído, continua excluído e a competência não muda.
  IF COALESCE(cardinality(p_timesheets), 0) > 0 THEN
    UPDATE operations.timesheets t
    SET apagado_em = NULL,
        apagado_por = NULL,
        periodo_faturamento = CASE WHEN t.excluido_faturamento THEN t.periodo_faturamento
          ELSE GREATEST(v_mes, COALESCE(t.periodo_faturamento, t.data_lancamento::date)) END,
        restaurado_da_lixeira_em = CASE WHEN t.excluido_faturamento THEN t.restaurado_da_lixeira_em ELSE now() END,
        restaurado_da_lixeira_por = CASE WHEN t.excluido_faturamento THEN t.restaurado_da_lixeira_por ELSE p_user_id END,
        updated_at = now(),
        updated_by = p_user_id
    WHERE t.tenant_id = v_tenant_id
      AND t.id = ANY(p_timesheets)
      AND t.apagado_em >= v_limite
      -- Por garantia (apagar cancela o item aberto): com item vivo contaria
      -- em dobro.
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = t.id AND bi.status <> 'cancelado'
      );
    GET DIAGNOSTICS v_n_ts = ROW_COUNT;
  END IF;

  -- Despesa apagada: mesma regra de competência. Status fica o que o apagar
  -- deixou (em_lancamento quando o item foi cancelado). Despesa de lote que
  -- entrou em validação/fechou depois não volta: mudaria o saldo acertado.
  IF COALESCE(cardinality(p_despesas), 0) > 0 THEN
    UPDATE operations.despesas d
    SET apagado_em = NULL,
        apagado_por = NULL,
        periodo_faturamento = GREATEST(v_mes, COALESCE(d.periodo_faturamento, d.data_lancamento::date)),
        updated_at = now(),
        updated_by = p_user_id
    WHERE d.tenant_id = v_tenant_id
      AND d.id = ANY(p_despesas)
      AND d.apagado_em >= v_limite
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'despesa'
          AND bi.origem_id = d.id AND bi.status <> 'cancelado'
      )
      AND NOT EXISTS (
        SELECT 1 FROM operations.despesa_lotes l
        WHERE l.id = d.lote_id AND l.status IN ('em_validacao', 'fechado')
      );
    GET DIAGNOSTICS v_n_desp = ROW_COUNT;
  END IF;

  -- Item ignorado (etapa 3, Filipe 30/10): volta para a revisão do mês dele
  -- com o valor lançado. ignorar_billing_items zera valor_revisado/aprovado e
  -- não guarda o anterior, então a revisão se faz de novo. Fica no snapshot
  -- quem ignorou e por quê, e quem restaurou. Não volta se o lançamento já
  -- tem outro item vivo (cobraria duas vezes) ou se foi apagado.
  IF COALESCE(cardinality(p_ignorados), 0) > 0 THEN
    UPDATE finance.billing_items bi
    SET status = 'em_revisao',
        valor_revisado = NULL,
        valor_aprovado = NULL,
        snapshot = COALESCE(bi.snapshot, '{}'::jsonb) || jsonb_build_object(
          'restaurado_de_ignorado_em', now(),
          'restaurado_de_ignorado_por', p_user_id),
        updated_at = now(),
        updated_by = p_user_id
    WHERE bi.tenant_id = v_tenant_id
      AND bi.id = ANY(p_ignorados)
      AND bi.status = 'ignorado'
      AND COALESCE(NULLIF(bi.snapshot->>'ignorado_em', '')::timestamptz, bi.updated_at) >= v_limite
      AND NOT EXISTS (
        SELECT 1 FROM finance.billing_items o
        WHERE o.tenant_id = v_tenant_id AND o.origem_tipo = bi.origem_tipo AND o.origem_id = bi.origem_id
          AND o.id <> bi.id AND o.status NOT IN ('cancelado', 'ignorado')
      )
      AND NOT EXISTS (
        SELECT 1 FROM operations.timesheets t
        WHERE bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id AND t.apagado_em IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM operations.despesas d
        WHERE bi.origem_tipo = 'despesa' AND d.id = bi.origem_id AND d.apagado_em IS NOT NULL
      );
    GET DIAGNOSTICS v_n_ign = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'afetados', v_n_exc + v_n_ts + v_n_desp + v_n_ign,
    'ignorados', GREATEST(v_pedidos - (v_n_exc + v_n_ts + v_n_desp + v_n_ign), 0),
    'itens_ignorados', v_n_ign,
    'excluidos', v_n_exc,
    'timesheets', v_n_ts,
    'despesas', v_n_desp,
    'mes_corrente', v_mes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restaurar_lixeira_faturamento(uuid, uuid[], uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurar_lixeira_faturamento(uuid, uuid[], uuid[], uuid[], uuid[]) TO authenticated, service_role;
