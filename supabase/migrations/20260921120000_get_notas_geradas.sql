-- =====================================================================
-- Notas geradas: lista completa, com cliente, valor, cobrança e filtros
--
-- Filipe, 11/09: a tela de "Notas geradas" mostrava só nº, tipo, status e
-- contrato/caso — sem o cliente, o valor, o vencimento nem se a conta a
-- receber já foi paga. Em 16/09 (D16 = a) ele aprovou o formato: colunas
-- cliente, caso, valor, vencimento, situação da conta a receber, boleto e
-- competência; filtros por cliente, mês de emissão, tipo e status.
--
-- A edge get-notas-geradas sempre tentou uma RPC public.get_notas_geradas
-- que nunca existiu em migration: caía no fallback (consulta direta em
-- finance.billing_notes + lookups) que não trazia nada disso. Esta função é
-- a RPC que faltava. Mantém o contrato que a edge/tela já usam e acrescenta:
--   cliente_id / cliente_nome — em rateio a nota é do pagador
--                               (metadata.pagador_cliente_id), senão o
--                               cliente do contrato
--   tomador_nome              — razão social que foi na NFS-e
--   valor_total               — metadata.valor_total
--   vencimento                — finance.vencimento_para_nota(nota)
--   lancamento_*              — conta a receber (origem='faturamento')
--   boleto_status / linha_digitavel — boleto ligado a essa conta
--   competencia               — min(periodo_inicio) dos itens da nota
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_notas_geradas(
  p_user_id uuid,
  p_status text DEFAULT NULL,
  p_tipo_documento text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 200,
  p_cliente_id uuid DEFAULT NULL,
  p_mes date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_limit int := GREATEST(COALESCE(p_limit, 200), 1);
  v_ini date := CASE WHEN p_mes IS NULL THEN NULL ELSE date_trunc('month', p_mes)::date END;
  v_fim date := CASE WHEN p_mes IS NULL THEN NULL ELSE (date_trunc('month', p_mes) + interval '1 month')::date END;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.read', 'finance.faturamento.manage',
                               'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver notas geradas';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT
        bn.id,
        bn.numero,
        bn.status,
        bn.tipo_documento,
        bn.focus_status,
        bn.arquivo_nome,
        bn.arquivo_url,
        bn.metadata,
        bn.created_at,
        bn.created_by,
        bn.billing_batch_id,
        bb.numero                                        AS batch_numero,
        bn.contrato_id,
        ct.numero                                        AS contrato_numero,
        ct.nome_contrato                                 AS contrato_nome,
        bn.caso_id,
        cs.numero                                        AS caso_numero,
        cs.nome                                          AS caso_nome,
        cli.id                                           AS cliente_id,
        cli.nome                                         AS cliente_nome,
        COALESCE(NULLIF(bn.metadata->'focus_request'->>'razao_social_tomador', ''),
                 cli.nome)                               AS tomador_nome,
        NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total,
        finance.vencimento_para_nota(bn.id)              AS vencimento,
        l.id                                             AS lancamento_id,
        l.status                                         AS lancamento_status,
        l.vencimento                                     AS lancamento_vencimento,
        l.valor                                          AS lancamento_valor,
        bo.id                                            AS boleto_id,
        bo.status                                        AS boleto_status,
        bo.linha_digitavel,
        comp.competencia
      FROM finance.billing_notes bn
      LEFT JOIN finance.billing_batches bb ON bb.id = bn.billing_batch_id
      LEFT JOIN contracts.contratos ct ON ct.id = bn.contrato_id
      LEFT JOIN contracts.casos cs ON cs.id = bn.caso_id
      -- Em rateio a nota sai no nome do pagador; fora disso, do cliente do contrato.
      LEFT JOIN crm.clientes cli
        ON cli.id = COALESCE(NULLIF(bn.metadata->>'pagador_cliente_id', '')::uuid, ct.cliente_id)
      -- Conta a receber viva da nota (a cancelada fica de fora, igual ao
      -- gerador em 20260904130000).
      LEFT JOIN LATERAL (
        SELECT lc.id, lc.status, lc.vencimento, lc.valor
        FROM finance.lancamentos lc
        WHERE lc.tenant_id = bn.tenant_id
          AND lc.origem = 'faturamento'
          AND lc.origem_ref_id = bn.id
        ORDER BY (lc.status = 'cancelado'), lc.created_at DESC
        LIMIT 1
      ) l ON true
      -- Boleto da conta a receber; se houve reemissao, o vivo vem antes.
      LEFT JOIN LATERAL (
        SELECT bt.id, bt.status, bt.linha_digitavel
        FROM finance.boletos bt
        WHERE bt.lancamento_id = l.id
        ORDER BY (bt.status IN ('erro', 'baixado')), bt.created_at DESC
        LIMIT 1
      ) bo ON true
      LEFT JOIN LATERAL (
        SELECT min(bi.periodo_inicio) AS competencia
        FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) ids(id)
        JOIN finance.billing_items bi ON bi.id = ids.id::uuid
      ) comp ON true
      WHERE bn.tenant_id = v_tenant
        AND (p_status IS NULL OR bn.status = p_status)
        AND (p_tipo_documento IS NULL OR bn.tipo_documento = p_tipo_documento)
        AND (p_cliente_id IS NULL OR cli.id = p_cliente_id)
        AND (v_ini IS NULL OR (bn.created_at >= v_ini AND bn.created_at < v_fim))
        AND (v_search IS NULL OR (
             cli.nome ILIKE '%' || v_search || '%'
          OR cs.nome ILIKE '%' || v_search || '%'
          OR cs.numero::text ILIKE '%' || v_search || '%'
          OR ct.nome_contrato ILIKE '%' || v_search || '%'
          OR ct.numero::text ILIKE '%' || v_search || '%'
          OR bn.numero::text ILIKE '%' || v_search || '%'
          OR bn.metadata->'nfse_consulta'->>'numero_nfse' ILIKE '%' || v_search || '%'
          OR bn.arquivo_nome ILIKE '%' || v_search || '%'
        ))
      ORDER BY bn.created_at DESC
      LIMIT v_limit
    ) x
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.get_notas_geradas(uuid, text, text, text, int, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notas_geradas(uuid, text, text, text, int, uuid, date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
