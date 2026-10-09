-- Número do contrato exibido nas telas de faturamento (Filipe 09/10).
-- As telas mostravam "Contrato 650 — Contrato 314" porque recebiam só
-- contracts.contratos.numero (chave interna antiga). Acrescenta o campo NOVO
-- contrato_numero_sequencial (= COALESCE(numero_sequencial, numero)) ao lado de
-- contrato_numero, sem mexer em nenhum campo existente: filtros e buscas
-- continuam usando numero. Definições partem das de produção em 09/10/2026.

CREATE OR REPLACE FUNCTION public.get_composicao_fatura(p_user_id uuid, p_competencia date DEFAULT NULL::date, p_cliente_id uuid DEFAULT NULL::uuid, p_contrato_id uuid DEFAULT NULL::uuid, p_caso_id uuid DEFAULT NULL::uuid, p_regra text DEFAULT NULL::text, p_status_kit text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_regra text := NULLIF(trim(COALESCE(p_regra, '')), '');
  v_status text := NULLIF(trim(COALESCE(p_status_kit, '')), '');
  v_out jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.read', 'finance.faturamento.manage',
                               'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver a composição da fatura';
  END IF;

  WITH itens AS (
    SELECT bi.id, bi.contrato_id, bi.caso_id, bi.origem_tipo, bi.origem_id, bi.status,
           bi.data_referencia, bi.snapshot, bi.created_at,
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date AS competencia,
           -- Mesmo valor que vai na NFS-e (get_billing_items_aprovados_full).
           COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)::numeric AS valor,
           -- Horas de TODO item de timesheet, valha ele R$ 0 ou não (6.2).
           CASE WHEN bi.origem_tipo = 'timesheet'
                THEN COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0)
                ELSE 0 END::numeric AS horas
      FROM finance.billing_items bi
     WHERE bi.tenant_id = v_tenant
       AND bi.status IN ('aprovado', 'faturado')
  ),
  itens_chave AS (
    SELECT i.*,
           COALESCE(i.caso_id::text, 'contrato:' || i.contrato_id::text) || '|' || i.competencia::text AS chave
      FROM itens i
  ),
  kits AS (
    SELECT ic.chave, ic.caso_id, ic.contrato_id, ic.competencia,
           array_agg(ic.id) AS item_ids,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN 0 ELSE ic.valor END), 2) AS valor_servico,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN ic.valor ELSE 0 END), 2) AS valor_despesa,
           round(sum(ic.horas), 2) AS horas,
           count(*) FILTER (WHERE ic.origem_tipo = 'timesheet') AS lancamentos_timesheet,
           round(sum(ic.valor), 2) AS valor_total
      FROM itens_chave ic
     GROUP BY ic.chave, ic.caso_id, ic.contrato_id, ic.competencia
  ),
  -- (nota NFS-e, item) para cruzar com os kits sem varrer jsonb por kit.
  nota_itens AS (
    SELECT bn.id AS nota_id, x.value::uuid AS item_id
      FROM finance.billing_notes bn
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_fiscal_servico'
  ),
  kit_notas AS (
    SELECT DISTINCT ic.chave, ni.nota_id
      FROM itens_chave ic
      JOIN nota_itens ni ON ni.item_id = ic.id
  ),
  -- B1: quantos CASOS cada NFS-e cobre. Mais de um = nota conjunta (nota única
  -- por contrato, Filipe 07/10: Charles Sturmer, casos 1873 e 1877). Conta
  -- casos, não kits: a mesma nota com itens de dois meses do MESMO caso (A&S
  -- Fersa 2103, Bravia 2104) não é conjunta.
  nota_kits AS (
    SELECT ni.nota_id,
           count(DISTINCT COALESCE(ic.caso_id::text, 'contrato:' || ic.contrato_id::text)) AS n_kits
      FROM nota_itens ni
      JOIN itens_chave ic ON ic.id = ni.item_id
     GROUP BY ni.nota_id
  ),
  -- A NFS-e "do kit": a viva (gerado) primeiro, depois a mais recente.
  kit_nfse AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, bn.id, bn.numero, bn.status, bn.focus_status, bn.caso_id,
           bn.arquivo_nome, bn.arquivo_url, bn.created_at,
           COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                    NULLIF(bn.metadata->>'nfse_numero', '')) AS nfse_numero,
           NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total,
           (bn.caso_id IS NULL OR COALESCE(nk.n_kits, 1) > 1) AS compartilhada
      FROM kit_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
      LEFT JOIN nota_kits nk ON nk.nota_id = bn.id
     ORDER BY kn.chave, (bn.status = 'gerado') DESC, bn.created_at DESC
  ),
  -- Conta a receber da NFS-e do kit (cancelada por último, como em Notas geradas).
  kit_lanc AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nfse kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.id
     ORDER BY kn.chave, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_boleto AS (
    SELECT DISTINCT ON (kl.chave)
           kl.chave, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_lanc kl
      JOIN finance.boletos b ON b.lancamento_id = kl.id
     ORDER BY kl.chave, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  -- D11: boleto vivo em QUALQUER nota desses itens (até de nota cancelada) trava o kit.
  kit_boleto_vivo AS (
    SELECT DISTINCT kn.chave
      FROM kit_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE b.status NOT IN ('cancelado', 'erro', 'baixado')
  ),
  -- Rateio de pagadores (Filipe 08/10, caso 318): emit-nfse emite UMA NFS-e por
  -- pagador com os mesmos item_ids, e cada nota tem a sua conta a receber (no
  -- nome do pagador). Aqui, TODAS as NFS-e vivas do kit, cada uma com a sua
  -- conta e o seu boleto. kit_nfse acima continua escolhendo uma só (campos
  -- antigos intactos).
  kit_nfses_vivas AS (
    SELECT kn.chave, bn.id, bn.numero, bn.status, bn.focus_status, bn.arquivo_url,
           COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                    NULLIF(bn.metadata->>'nfse_numero', '')) AS nfse_numero,
           NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total,
           COALESCE(NULLIF(bn.metadata->>'pagador_cliente_id', '')::uuid, ct.cliente_id) AS pagador_id
      FROM kit_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
      JOIN kits k ON k.chave = kn.chave
      JOIN contracts.contratos ct ON ct.id = k.contrato_id
     WHERE bn.status = 'gerado'
       AND COALESCE(bn.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
  ),
  kit_nfses_lanc AS (
    SELECT DISTINCT ON (nv.id)
           nv.id AS nota_id, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM (SELECT DISTINCT id FROM kit_nfses_vivas) nv
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = nv.id
     ORDER BY nv.id, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_nfses_boleto AS (
    SELECT DISTINCT ON (nl.id)
           nl.id AS lanc_id, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_nfses_lanc nl
      JOIN finance.boletos b ON b.lancamento_id = nl.id
     ORDER BY nl.id, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  kit_nfses AS (
    SELECT nv.chave,
           count(*) AS n,
           bool_and(COALESCE(nl.status IN ('pago', 'recebido') OR nl.baixa_data IS NOT NULL, false)) AS todas_pagas,
           jsonb_agg(jsonb_build_object(
             'id', nv.id, 'numero', nv.numero, 'nfse_numero', nv.nfse_numero,
             'status', nv.status, 'focus_status', nv.focus_status,
             'arquivo_url', nv.arquivo_url, 'valor_total', nv.valor_total,
             'pagador', jsonb_build_object('cliente_id', nv.pagador_id, 'nome', pc.nome),
             'conta_receber', CASE WHEN nl.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', nl.id, 'valor', nl.valor, 'vencimento', nl.vencimento,
               'status', nl.status, 'pago_em', nl.baixa_data) END,
             'boleto', CASE WHEN nb.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', nb.id, 'status', nb.status, 'vencimento', nb.vencimento,
               'valor', nb.valor, 'linha_digitavel', nb.linha_digitavel,
               'nosso_numero', nb.nosso_numero, 'pix_emv', nb.pix_copia_cola) END
           ) ORDER BY pc.nome NULLS LAST, nv.numero) AS nfses
      FROM kit_nfses_vivas nv
      LEFT JOIN crm.clientes pc ON pc.id = nv.pagador_id
      LEFT JOIN kit_nfses_lanc nl ON nl.nota_id = nv.id
      LEFT JOIN kit_nfses_boleto nb ON nb.lanc_id = nl.id
     GROUP BY nv.chave
  ),
  -- Notas de débito do kit, de QUALQUER status: a conta a receber pode estar
  -- numa ND já substituída (regerada com boleto vivo) — mesma lógica da NFS-e.
  kit_nd_notas AS (
    SELECT k.chave, bn.id AS nota_id
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_debito'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
  ),
  kit_nd_lanc AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nd_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
     ORDER BY kn.chave, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_nd_boleto AS (
    SELECT DISTINCT ON (kl.chave)
           kl.chave, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_nd_lanc kl
      JOIN finance.boletos b ON b.lancamento_id = kl.id
     ORDER BY kl.chave, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  kit_nd_boleto_vivo AS (
    SELECT DISTINCT kn.chave
      FROM kit_nd_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE b.status NOT IN ('cancelado', 'erro', 'baixado')
  ),
  kit_envio AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, e.enviado_em, e.destinatario, e.erro, c.nome AS por,
           count(*) OVER (PARTITION BY kn.chave) AS total,
           bool_or(e.erro IS NULL) OVER (PARTITION BY kn.chave) AS algum_ok
      FROM kit_nfse kn
      JOIN finance.fatura_envios e ON e.tenant_id = v_tenant AND e.billing_note_id = kn.id
      LEFT JOIN people.colaboradores c ON c.user_id = e.enviado_por AND c.tenant_id = v_tenant
     ORDER BY kn.chave, e.enviado_em DESC
  ),
  -- Relatório de timesheet / nota de débito registrados (D12-a), por kit.
  kit_docs AS (
    SELECT DISTINCT ON (k.chave, bn.tipo_documento)
           k.chave, bn.tipo_documento, bn.id, bn.created_at, bn.arquivo_nome, bn.arquivo_url,
           COALESCE(NULLIF(bn.metadata->>'gerado_por_nome', ''), c.nome) AS gerado_por
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
       AND bn.status = 'gerado'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
      LEFT JOIN people.colaboradores c ON c.user_id = bn.created_by AND c.tenant_id = v_tenant
     ORDER BY k.chave, bn.tipo_documento, bn.created_at DESC
  ),
  -- Estado do kit (24/09): carimbo de finalizado e ajustes desta competência.
  -- Nome do pagador e do grupo resolvidos na hora (o cadastro pode ter mudado
  -- depois que o ajuste foi salvo).
  kit_estado AS (
    SELECT k.chave,
           fk.finalizado_em, fk.finalizado_obs,
           COALESCE(cf.nome, 'Usuário') AS finalizado_por_nome,
           NULLIF(fk.ajustes->>'grupo_imposto_id', '')::uuid AS aj_grupo_id,
           gia.nome AS aj_grupo_nome,
           CASE WHEN jsonb_typeof(fk.ajustes->'pagadores') = 'array'
                 AND jsonb_array_length(fk.ajustes->'pagadores') > 0
                THEN (
                  SELECT jsonb_agg(jsonb_build_object(
                           'cliente_id', pg.cliente_id, 'nome', pc.nome, 'percentual', pg.percentual)
                         ORDER BY pg.percentual DESC, pc.nome)
                    FROM (
                      SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
                             COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 100) AS percentual
                        FROM jsonb_array_elements(fk.ajustes->'pagadores') p
                    ) pg
                    LEFT JOIN crm.clientes pc ON pc.id = pg.cliente_id)
                ELSE NULL END AS aj_pagadores
      FROM kits k
      JOIN finance.kits fk
        ON fk.tenant_id = v_tenant
       AND fk.contrato_id = k.contrato_id
       AND fk.caso_id IS NOT DISTINCT FROM k.caso_id
       AND fk.competencia = k.competencia
      LEFT JOIN people.colaboradores cf ON cf.user_id = fk.finalizado_por AND cf.tenant_id = v_tenant
      LEFT JOIN contracts.grupos_impostos gia ON gia.id = NULLIF(fk.ajustes->>'grupo_imposto_id', '')::uuid
  ),
  kit_full AS (
    SELECT k.*,
           ct.cliente_id, cli.nome AS cliente_nome,
           ct.numero AS contrato_numero, ct.nome_contrato AS contrato_nome,
           COALESCE(ct.numero_sequencial, ct.numero) AS contrato_numero_sequencial,
           cs.numero AS caso_numero, cs.nome AS caso_nome,
           COALESCE(cs.enviar_relatorio_timesheet, false) AS enviar_relatorio_timesheet,
           COALESCE(
             NULLIF(cs.regra_cobranca, ''),
             (SELECT NULLIF(r->>'regra_cobranca', '')
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                                               THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
               WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
                 AND NULLIF(r->>'regra_cobranca', '') IS NOT NULL
               LIMIT 1)
           ) AS regra_cobranca,
           -- Grupo/pagadores do CADASTRO (contrato/caso)...
           CASE WHEN gi.id IS NULL THEN NULL
                ELSE jsonb_build_object('id', gi.id, 'nome', gi.nome) END AS grupo_imposto_cadastro,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'cliente_id', pg.cliente_id, 'nome', pc.nome, 'percentual', pg.percentual)
                    ORDER BY pg.percentual DESC, pc.nome)
               FROM (
                 SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
                        COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 100) AS percentual
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(cs.pagadores_servico) = 'array'
                                AND jsonb_array_length(cs.pagadores_servico) > 0
                               THEN cs.pagadores_servico
                               ELSE jsonb_build_array(jsonb_build_object('cliente_id', ct.cliente_id, 'percentual', 100))
                          END) p
               ) pg
               LEFT JOIN crm.clientes pc ON pc.id = pg.cliente_id
           ), '[]'::jsonb) AS pagadores_cadastro,
           -- ...e o ajuste do kit, quando houver (print 5: vale só neste mês).
           ke.finalizado_em, ke.finalizado_por_nome, ke.finalizado_obs,
           ke.aj_grupo_id, ke.aj_grupo_nome, ke.aj_pagadores,
           nf.id AS nfse_id, nf.numero AS nfse_numero_interno, nf.nfse_numero, nf.status AS nfse_status,
           nf.focus_status AS nfse_focus_status, nf.arquivo_nome AS nfse_arquivo_nome,
           nf.arquivo_url AS nfse_arquivo_url, nf.valor_total AS nfse_valor_total,
           nf.created_at AS nfse_created_at,
           COALESCE(nf.compartilhada, false) AS nota_compartilhada,
           COALESCE(kns.nfses, '[]'::jsonb) AS nfses_json,
           -- Base do boleto. Kit com serviço (ou que já tem conta da NFS-e):
           -- NFS-e, como sempre. Kit só de despesas: a conta a receber da nota
           -- de débito, quando existe e está viva (07/10). Senão, nada ainda.
           CASE
             WHEN l.id IS NOT NULL OR k.valor_servico > 0 THEN 'nfse'
             WHEN ndl.id IS NOT NULL AND ndl.status <> 'cancelado' THEN 'nota_debito'
             ELSE NULL
           END AS boleto_base,
           -- Conta a receber e boleto "do kit": da NFS-e, ou da ND no kit só de despesas.
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.id ELSE bo.id END AS boleto_id,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.status ELSE bo.status END AS boleto_status,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.vencimento ELSE bo.vencimento END AS boleto_vencimento,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.valor ELSE bo.valor END AS boleto_valor,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.linha_digitavel ELSE bo.linha_digitavel END AS linha_digitavel,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.nosso_numero ELSE bo.nosso_numero END AS nosso_numero,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.pix_copia_cola ELSE bo.pix_copia_cola END AS pix_copia_cola,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.id ELSE l.id END AS lanc_id,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END AS lanc_status,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.valor ELSE l.valor END AS lanc_valor,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.vencimento ELSE l.vencimento END AS lanc_vencimento,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END AS lanc_baixa_data,
           -- Lançamento da ND exposto só quando é ele que sustenta o boleto do kit.
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 AND ndl.status <> 'cancelado' THEN ndl.id END AS nd_lanc_id,
           env.enviado_em, env.destinatario, env.por AS envio_por, env.erro AS envio_erro,
           env.total AS envio_total, COALESCE(env.algum_ok, false) AS envio_ok,
           -- Boleto vivo em qualquer nota do kit (NFS-e ou ND) trava a devolução.
           (bv.chave IS NOT NULL OR ndbv.chave IS NOT NULL) AS boleto_vivo,
           -- B1: kits deste contrato+competência que ainda cabem numa nota única
           -- (têm serviço e não têm NFS-e viva). Conta o próprio kit; front usa >= 2.
           count(*) FILTER (
             WHERE k.valor_servico > 0
               AND NOT COALESCE(nf.status = 'gerado' AND COALESCE(nf.focus_status, '') NOT IN ('erro', 'erro_autorizacao'), false)
           ) OVER (PARTITION BY k.contrato_id, k.competencia) AS irmaos_no_contrato,
           CASE
             WHEN (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END) IN ('pago', 'recebido')
               OR (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END) IS NOT NULL
             THEN CASE
                    -- Mais de um pagador: recebido só com TODAS as contas pagas.
                    WHEN COALESCE(kns.n, 0) > 1 AND NOT kns.todas_pagas THEN
                      CASE
                        WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
                        WHEN COALESCE(env.algum_ok, false) THEN 'enviado'
                        WHEN nf.status = 'gerado' AND nf.focus_status IN ('autorizado', 'processando') THEN 'nf_emitida'
                        ELSE 'pendente'
                      END
                    ELSE 'recebido'
                  END
             WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
             WHEN COALESCE(env.algum_ok, false) THEN 'enviado'
             WHEN nf.status = 'gerado' AND nf.focus_status IN ('autorizado', 'processando') THEN 'nf_emitida'
             ELSE 'pendente'
           END AS status_kit
      FROM kits k
      JOIN contracts.contratos ct ON ct.id = k.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      LEFT JOIN contracts.casos cs ON cs.id = k.caso_id
      LEFT JOIN contracts.grupos_impostos gi ON gi.id = ct.grupo_imposto_id
      LEFT JOIN kit_nfse nf ON nf.chave = k.chave
      LEFT JOIN kit_lanc l ON l.chave = k.chave
      LEFT JOIN kit_boleto bo ON bo.chave = k.chave
      LEFT JOIN kit_nd_lanc ndl ON ndl.chave = k.chave
      LEFT JOIN kit_nd_boleto ndb ON ndb.chave = k.chave
      LEFT JOIN kit_envio env ON env.chave = k.chave
      LEFT JOIN kit_boleto_vivo bv ON bv.chave = k.chave
      LEFT JOIN kit_nd_boleto_vivo ndbv ON ndbv.chave = k.chave
      LEFT JOIN kit_estado ke ON ke.chave = k.chave
      LEFT JOIN kit_nfses kns ON kns.chave = k.chave
  ),
  filtrado AS (
    SELECT kf.*,
           CASE
             -- Nota única por contrato: devolver um caso desfaria a nota dos outros.
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status IN ('autorizado', 'processando')
                  AND kf.nota_compartilhada
               THEN 'NFS-e conjunta com outros casos'
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status = 'autorizado'
               THEN 'NFS-e ' || COALESCE(kf.nfse_numero, kf.nfse_numero_interno::text) || ' autorizada'
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status = 'processando'
               THEN 'NFS-e ' || COALESCE(kf.nfse_numero, kf.nfse_numero_interno::text) || ' em processamento'
             WHEN kf.boleto_vivo THEN 'Boleto registrado'
             ELSE NULL
           END AS motivo_bloqueio,
           (kf.aj_grupo_id IS NOT NULL OR kf.aj_pagadores IS NOT NULL) AS ajustes_do_kit,
           -- O que a NFS-e vai usar: o ajuste do kit manda sobre o cadastro.
           CASE WHEN kf.aj_grupo_id IS NOT NULL
                THEN jsonb_build_object('id', kf.aj_grupo_id, 'nome', kf.aj_grupo_nome)
                ELSE kf.grupo_imposto_cadastro END AS grupo_imposto,
           COALESCE(kf.aj_pagadores, kf.pagadores_cadastro) AS pagadores
      FROM kit_full kf
     WHERE (v_competencia IS NULL OR kf.competencia = v_competencia)
       AND (p_cliente_id IS NULL OR kf.cliente_id = p_cliente_id)
       AND (p_contrato_id IS NULL OR kf.contrato_id = p_contrato_id)
       AND (p_caso_id IS NULL OR kf.caso_id = p_caso_id)
       AND (v_regra IS NULL OR kf.regra_cobranca = v_regra)
       AND (v_status IS NULL OR kf.status_kit = v_status)
  ),
  itens_json AS (
    SELECT ic.chave,
           jsonb_agg(jsonb_build_object(
             'id', ic.id,
             'origem_tipo', ic.origem_tipo,
             'descricao', CASE ic.origem_tipo
               WHEN 'timesheet' THEN COALESCE(NULLIF(ic.snapshot->>'timesheet_descricao', ''), 'Timesheet')
               WHEN 'despesa'   THEN COALESCE(NULLIF(ic.snapshot->>'descricao', ''), 'Despesa')
               ELSE COALESCE(NULLIF(ic.snapshot->>'regra_nome', ''),
                             NULLIF(ic.snapshot->>'descricao', ''),
                             NULLIF(ic.snapshot->>'regra_cobranca', ''),
                             'Regra financeira')
             END,
             'data_referencia', ic.data_referencia,
             'horas', ic.horas,
             'valor', ic.valor,
             'status', ic.status,
             'linhas_timesheet', CASE WHEN ic.origem_tipo <> 'timesheet' THEN '[]'::jsonb ELSE
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'data', COALESCE(NULLIF(r->>'data_lancamento', ''), ic.snapshot->>'timesheet_data_lancamento'),
                          'profissional', COALESCE(NULLIF(r->>'profissional', ''), ic.snapshot->>'timesheet_profissional'),
                          'foto_url', (SELECT col.foto_url FROM operations.timesheets t JOIN people.colaboradores col ON col.user_id = t.created_by WHERE t.id = ic.origem_id LIMIT 1),
                          'cargo', NULLIF(r->>'cargo', ''),
                          'descricao', COALESCE(NULLIF(r->>'atividade', ''), NULLIF(r->>'descricao', ''), ic.snapshot->>'timesheet_descricao'),
                          'horas', lh.horas,
                          'valor_hora', lh.valor_hora,
                          'valor', round(lh.horas * lh.valor_hora, 2)
                        ) ORDER BY NULLIF(r->>'data_lancamento', '')::date NULLS LAST)
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(ic.snapshot->'timesheet_itens_revisao') = 'array'
                               THEN ic.snapshot->'timesheet_itens_revisao' ELSE '[]'::jsonb END) r
                   CROSS JOIN LATERAL (
                     SELECT COALESCE(NULLIF(r->>'horas_revisadas', '')::numeric,
                                     NULLIF(r->>'horas', '')::numeric,
                                     NULLIF(r->>'horas_iniciais', '')::numeric, 0) AS horas,
                            COALESCE(NULLIF(r->>'valor_hora', '')::numeric, 0) AS valor_hora
                   ) lh
               ), jsonb_build_array(jsonb_build_object(
                    'data', ic.snapshot->>'timesheet_data_lancamento',
                    'profissional', ic.snapshot->>'timesheet_profissional',
                    'foto_url', (SELECT col.foto_url FROM operations.timesheets t JOIN people.colaboradores col ON col.user_id = t.created_by WHERE t.id = ic.origem_id LIMIT 1),
                    'cargo', NULL,
                    'descricao', ic.snapshot->>'timesheet_descricao',
                    'horas', ic.horas,
                    'valor_hora', COALESCE(NULLIF(ic.snapshot->>'timesheet_valor_hora', '')::numeric,
                                           NULLIF(ic.snapshot->>'valor_hora', '')::numeric,
                                           CASE WHEN ic.horas > 0 THEN round(ic.valor / ic.horas, 2) ELSE 0 END),
                    'valor', ic.valor)))
             END,
             'despesa', CASE WHEN ic.origem_tipo <> 'despesa' THEN NULL ELSE jsonb_build_object(
               'data', COALESCE(NULLIF(ic.snapshot->'valor_itens_revisao'->0->>'referencia', ''), ic.data_referencia::text),
               'categoria', NULLIF(ic.snapshot->>'categoria', ''),
               'descricao', NULLIF(ic.snapshot->>'descricao', ''),
               'valor', ic.valor) END
           ) ORDER BY ic.data_referencia NULLS LAST, ic.created_at) AS itens
      FROM itens_chave ic
     WHERE ic.chave IN (SELECT f.chave FROM filtrado f)
     GROUP BY ic.chave
  ),
  casos_json AS (
    SELECT f.cliente_id, f.cliente_nome, f.valor_total, f.contrato_numero, f.caso_numero,
           jsonb_build_object(
             'chave', f.chave,
             'caso_id', f.caso_id,
             'caso_numero', f.caso_numero,
             'caso_nome', COALESCE(f.caso_nome, 'Sem caso'),
             'regra_cobranca', f.regra_cobranca,
             'contrato_id', f.contrato_id,
             'contrato_numero', f.contrato_numero,
             'contrato_numero_sequencial', f.contrato_numero_sequencial,
             'contrato_nome', f.contrato_nome,
             'competencia', f.competencia,
             'enviar_relatorio_timesheet', f.enviar_relatorio_timesheet,
             'grupo_imposto', f.grupo_imposto,
             'pagadores', f.pagadores,
             'ajustes_do_kit', f.ajustes_do_kit,
             'ajustes_kit', CASE WHEN NOT f.ajustes_do_kit THEN NULL ELSE jsonb_build_object(
               'grupo_imposto_id', f.aj_grupo_id,
               'grupo_imposto_nome', f.aj_grupo_nome,
               'pagadores', f.aj_pagadores) END,
             'finalizado', CASE WHEN f.finalizado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'em', f.finalizado_em, 'por_nome', f.finalizado_por_nome, 'obs', f.finalizado_obs) END,
             'valor_servico', f.valor_servico,
             'valor_despesa', f.valor_despesa,
             'horas', f.horas,
             'lancamentos_timesheet', f.lancamentos_timesheet,
             'valor_total', f.valor_total,
             'itens', COALESCE(ij.itens, '[]'::jsonb),
             'documentos', jsonb_build_object(
               'nfse', CASE WHEN f.nfse_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', f.nfse_id, 'numero', f.nfse_numero_interno, 'nfse_numero', f.nfse_numero,
                 'status', f.nfse_status, 'focus_status', f.nfse_focus_status,
                 'arquivo_nome', f.nfse_arquivo_nome, 'arquivo_url', f.nfse_arquivo_url,
                 'valor_total', f.nfse_valor_total, 'created_at', f.nfse_created_at,
                 'compartilhada', f.nota_compartilhada) END,
               'nfses', f.nfses_json,
               'boleto', CASE WHEN f.boleto_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', f.boleto_id, 'status', f.boleto_status, 'vencimento', f.boleto_vencimento,
                 'valor', f.boleto_valor, 'linha_digitavel', f.linha_digitavel,
                 'nosso_numero', f.nosso_numero, 'pix_emv', f.pix_copia_cola) END,
               'relatorio_timesheet', (
                 SELECT jsonb_build_object('id', d.id, 'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'relatorio_timesheet'),
               'nota_debito', (
                 SELECT jsonb_build_object('id', d.id, 'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url,
                                           'lancamento_id', f.nd_lanc_id)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'nota_debito')
             ),
             'boleto_base', f.boleto_base,
             'envio', CASE WHEN f.enviado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'enviado_em', f.enviado_em, 'destinatario', f.destinatario, 'por', f.envio_por,
               'erro', f.envio_erro, 'total', f.envio_total) END,
             'conta_receber', CASE WHEN f.lanc_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', f.lanc_id, 'status', f.lanc_status, 'valor', f.lanc_valor,
               'vencimento', f.lanc_vencimento, 'pago_em', f.lanc_baixa_data) END,
             'irmaos_no_contrato', f.irmaos_no_contrato,
             'nota_compartilhada', f.nota_compartilhada,
             'status_kit', f.status_kit,
             'pode_excluir', (f.motivo_bloqueio IS NULL),
             'motivo_bloqueio', f.motivo_bloqueio
           ) AS caso
      FROM filtrado f
      LEFT JOIN itens_json ij ON ij.chave = f.chave
  ),
  clientes_json AS (
    SELECT cj.cliente_id, cj.cliente_nome,
           jsonb_build_object(
             'cliente_id', cj.cliente_id,
             'nome', COALESCE(cj.cliente_nome, 'Cliente sem nome'),
             'valor_total', round(sum(cj.valor_total), 2),
             'kits', count(*),
             'casos', jsonb_agg(cj.caso ORDER BY cj.contrato_numero NULLS LAST, cj.caso_numero NULLS LAST)
           ) AS cliente
      FROM casos_json cj
     GROUP BY cj.cliente_id, cj.cliente_nome
  )
  SELECT jsonb_build_object(
    'resumo', jsonb_build_object(
      'kits', (SELECT count(*) FROM filtrado),
      'valor_total', (SELECT COALESCE(round(sum(valor_total), 2), 0) FROM filtrado),
      'por_status', (
        SELECT jsonb_object_agg(s.status, jsonb_build_object(
                 'kits', COALESCE(t.kits, 0), 'valor', COALESCE(t.valor, 0)))
          FROM (VALUES ('pendente'), ('nf_emitida'), ('enviado'), ('finalizado'), ('recebido')) s(status)
          LEFT JOIN (
            SELECT f.status_kit, count(*) AS kits, round(sum(f.valor_total), 2) AS valor
              FROM filtrado f GROUP BY f.status_kit
          ) t ON t.status_kit = s.status
      )
    ),
    'opcoes', jsonb_build_object(
      'competencias', COALESCE((SELECT jsonb_agg(c ORDER BY c DESC)
                                  FROM (SELECT DISTINCT competencia AS c FROM kit_full) z), '[]'::jsonb),
      'clientes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.cliente_id, 'nome', z.cliente_nome) ORDER BY z.cliente_nome)
                              FROM (SELECT DISTINCT cliente_id, cliente_nome FROM kit_full WHERE cliente_id IS NOT NULL) z), '[]'::jsonb),
      'contratos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.contrato_id, 'numero', z.contrato_numero,
                                                                  'numero_sequencial', z.contrato_numero_sequencial,
                                                                  'nome', z.contrato_nome, 'cliente_id', z.cliente_id)
                                              ORDER BY z.contrato_numero NULLS LAST)
                               FROM (SELECT DISTINCT contrato_id, contrato_numero, contrato_numero_sequencial, contrato_nome, cliente_id FROM kit_full) z), '[]'::jsonb),
      'casos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.caso_id, 'numero', z.caso_numero,
                                                              'nome', z.caso_nome, 'contrato_id', z.contrato_id)
                                          ORDER BY z.caso_numero NULLS LAST)
                           FROM (SELECT DISTINCT caso_id, caso_numero, caso_nome, contrato_id FROM kit_full WHERE caso_id IS NOT NULL) z), '[]'::jsonb),
      'regras', COALESCE((SELECT jsonb_agg(r ORDER BY r)
                            FROM (SELECT DISTINCT regra_cobranca AS r FROM kit_full WHERE regra_cobranca IS NOT NULL) z), '[]'::jsonb)
    ),
    'clientes', COALESCE((SELECT jsonb_agg(c.cliente ORDER BY c.cliente_nome NULLS LAST) FROM clientes_json c), '[]'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_revisao_fatura(p_user_id uuid, p_status character varying DEFAULT NULL::character varying, p_lote text DEFAULT NULL::text, p_cliente text DEFAULT NULL::text, p_contrato text DEFAULT NULL::text, p_caso text DEFAULT NULL::text, p_competencia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_read boolean := false;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_competencia date;
BEGIN
  -- Tenant + regra de visibilidade (vê tudo / escopo por centro de custo)
  -- agora vivem em finance.escopo_faturamento, compartilhada com a fila
  -- (get_fila_por_competencia). Mesma regra nos dois lugares, por construção.
  SELECT e.tenant_id, e.can_view_all, e.viewer_area_id
  INTO v_tenant_id, v_can_view_all, v_viewer_area_id
  FROM finance.escopo_faturamento(p_user_id) e;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_competencia := date_trunc('month', p_competencia)::date;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read',
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_read;

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'Sem permissão para visualizar revisão de fatura';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'billing_item_id', bi.id,
          'item_numero', bi.numero,
          'billing_batch_id', bi.billing_batch_id,
          'batch_numero', b.numero,
          'status', bi.status,
          'grupo_id', bi.grupo_id,
          'origem_tipo', bi.origem_tipo,
          'origem_id', bi.origem_id,
          'data_referencia', bi.data_referencia,
          'cliente_id', cli.id,
          'cliente_nome', cli.nome,
          'contrato_id', c.id,
          'contrato_numero', c.numero,
          'contrato_nome', c.nome_contrato,
          'caso_id', cs.id,
          'caso_numero', cs.numero,
          'caso_nome', cs.nome,
          'regra_nome', COALESCE(
            NULLIF(bi.snapshot->>'regra_nome', ''),
            NULLIF(bi.snapshot->>'descricao', ''),
            CASE WHEN bi.origem_tipo = 'timesheet' THEN 'Timesheet' ELSE 'Regra financeira' END
          ),
          -- regra_cobranca do CASO (não do snapshot): permite ao front agrupar
          -- horas de casos 'projeto' na aba Projeto em vez de Horas.
          'revisores_modo', cs.timesheet_config->>'revisores_modo',
          'timesheet_descricao_original', NULLIF(bi.snapshot->>'timesheet_descricao_original', ''),
          'valor_hora_atual', COALESCE(vha.valor_hora_atual, 0),
          'caso_regra_cobranca', CASE
            WHEN bi.origem_tipo = 'timesheet' THEN
              -- aba Horas só quando o caso cobra por hora; senão a regra ativa do caso
              CASE
                WHEN regra_caso.tem_hora THEN 'hora'
                ELSE COALESCE(regra_caso.primeira_ativa, NULLIF(cs.regra_cobranca, ''))
              END
            ELSE COALESCE(
              NULLIF(bi.snapshot->>'regra_cobranca', ''),
              NULLIF(cs.regra_cobranca, ''),
              regra_caso.primeira_ativa
            )
          END,
          'horas_informadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_informadas ELSE 0::numeric END,
          'horas_revisadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_revisadas ELSE 0::numeric END,
          'horas_aprovadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_aprovadas ELSE 0::numeric END,
          'valor_informado', bi.valor_informado,
          'valor_revisado', bi.valor_revisado,
          'valor_aprovado', bi.valor_aprovado,
          'data_revisao', bi.data_revisao,
          'data_aprovacao', bi.data_aprovacao,
          'responsavel_revisao_id', bi.responsavel_revisao_id,
          'responsavel_aprovacao_id', bi.responsavel_aprovacao_id,
          'responsavel_revisao_nome', COALESCE(rev_actor_colab.nome, rev_colab.nome, auto_rev.nome),
          'responsavel_aprovacao_nome', COALESCE(apr_actor_colab.nome, apr_colab.nome),
          'responsavel_fluxo_nome', CASE
            WHEN bi.status = 'em_revisao' THEN COALESCE(rev_actor_colab.nome, rev_colab.nome, auto_rev.nome)
            WHEN bi.status = 'em_aprovacao' THEN COALESCE(apr_actor_colab.nome, apr_colab.nome)
            ELSE NULL
          END,
          'enviado_por_foto', COALESCE(ts_colab.foto_url, orig_colab.foto_url),
          'revisor_foto', COALESCE(rev_actor_colab.foto_url, rev_colab.foto_url, auto_rev.foto_url),
          'aprovador_foto', COALESCE(apr_actor_colab.foto_url, apr_colab.foto_url),
          'enviado_por_id', COALESCE(t.created_by, bi.created_by),
          'enviado_por_nome', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_profissional', ''),
            ts_colab.nome,
            orig_colab.nome
          ),
          'timesheet_id', CASE WHEN bi.origem_tipo = 'timesheet' THEN t.id ELSE NULL END,
          'timesheet_data_lancamento', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_data_lancamento', ''),
            CASE WHEN t.data_lancamento IS NOT NULL THEN t.data_lancamento::text ELSE NULL END
          ),
          'timesheet_horas', CASE
            WHEN bi.origem_tipo = 'timesheet' THEN COALESCE(
              NULLIF(bi.snapshot->>'timesheet_horas', '')::numeric,
              t.horas,
              bi.horas_informadas,
              0
            )
            ELSE 0::numeric
          END,
          'timesheet_descricao', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_descricao', ''),
            t.descricao,
            ''
          ),
          'timesheet_profissional', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_profissional', ''),
            ts_colab.nome,
            ''
          ),
          'timesheet_valor_hora', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_valor_hora', '')::numeric,
            NULLIF(bi.snapshot->>'valor_hora', '')::numeric,
            CASE
              WHEN bi.origem_tipo = 'timesheet' AND COALESCE(t.horas, bi.horas_informadas, 0) > 0
                THEN COALESCE(bi.valor_informado, 0) / COALESCE(t.horas, bi.horas_informadas)
              ELSE 0
            END
          ),
          'snapshot', bi.snapshot,
          'updated_at', bi.updated_at,
          'historico', COALESCE(rfih.hist, '[]'::jsonb)
        )
        -- Campos do grupo por fora: o objeto acima ja esta no teto de 100
        -- argumentos do jsonb_build_object.
        || jsonb_build_object(
          'contrato_numero_sequencial', COALESCE(c.numero_sequencial, c.numero),
          'grupo_texto', gr.texto,
          'grupo_horas', gr.horas_revisadas,
          'grupo_valor', gr.valor_revisado,
          -- Centro de custo do item, para o filtro da barra superior (Filipe
          -- 07/08). Reusa ia.area_id, que ja era calculado para as regras de
          -- visibilidade: timesheet usa a area do autor; os demais, o primeiro
          -- centro de custo do rateio do caso.
          'centro_custo_nome', ar_item.nome,
          -- Competência = mês de faturamento do item (periodo_inicio gravado
          -- ao liberar; item antigo sem período cai na data de criação).
          -- A tela agrupa as abas por isto.
          'periodo_inicio', bi.periodo_inicio,
          'periodo_fim', bi.periodo_fim,
          'competencia', date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date
        )
        ORDER BY cli.nome, c.numero NULLS LAST, cs.numero NULLS LAST, bi.numero
      ),
      '[]'::jsonb
    )
    FROM finance.billing_items bi
    LEFT JOIN finance.billing_batches b
      ON b.id = bi.billing_batch_id
     AND b.tenant_id = bi.tenant_id
    JOIN crm.clientes cli
      ON cli.id = bi.cliente_id
     AND cli.tenant_id = bi.tenant_id
    JOIN contracts.contratos c
      ON c.id = bi.contrato_id
     AND c.tenant_id = bi.tenant_id
    JOIN contracts.casos cs
      ON cs.id = bi.caso_id
     AND cs.tenant_id = bi.tenant_id
    LEFT JOIN LATERAL (
      SELECT
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
          ) r
          WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca','') IN ('hora','hora_com_cap')
        ) OR NULLIF(cs.regra_cobranca,'') IN ('hora','hora_com_cap') AS tem_hora,
        (
          SELECT NULLIF(r->>'regra_cobranca','') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
          ) r
          WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca','') IS NOT NULL
          LIMIT 1
        ) AS primeira_ativa
    ) regra_caso ON true
    LEFT JOIN LATERAL (
      SELECT t.cargo_id
      FROM operations.timesheets t
      WHERE bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id
      LIMIT 1
    ) ts_cargo ON true
    LEFT JOIN LATERAL (
      -- valor/hora VIGENTE da regra hora do caso (mudou na origem -> reflete aqui)
      -- Resolve pela tabela de preço do cargo congelado no lançamento; sem
      -- tabela, cai no valor avulso (mesmo resultado de antes).
      SELECT public.resolver_valor_hora(cs.id, ts_cargo.cargo_id) AS valor_hora_atual
    ) vha ON true
    LEFT JOIN LATERAL (
      SELECT NULLIF(r->>'colaborador_id', '')::uuid AS colaborador_id
      FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'revisores', '[]'::jsonb)) r
      ORDER BY COALESCE(NULLIF(r->>'ordem', '')::int, 999999)
      LIMIT 1
    ) rev_cfg ON true
    LEFT JOIN LATERAL (
      SELECT NULLIF(a->>'colaborador_id', '')::uuid AS colaborador_id
      FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'aprovadores', '[]'::jsonb)) a
      ORDER BY COALESCE(NULLIF(a->>'ordem', '')::int, 999999)
      LIMIT 1
    ) apr_cfg ON true
    LEFT JOIN people.colaboradores rev_colab
      ON rev_colab.id = rev_cfg.colaborador_id
     AND rev_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores apr_colab
      ON apr_colab.id = apr_cfg.colaborador_id
     AND apr_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores rev_actor_colab
      ON rev_actor_colab.user_id = bi.responsavel_revisao_id
     AND rev_actor_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores apr_actor_colab
      ON apr_actor_colab.user_id = bi.responsavel_aprovacao_id
     AND apr_actor_colab.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t
      ON bi.origem_tipo = 'timesheet'
     AND t.id = bi.origem_id
     AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab
      ON ts_colab.user_id = t.created_by
     AND ts_colab.tenant_id = bi.tenant_id
    -- Área do item: p/ timesheet = área do autor; senão = 1º centro de custo do rateio do caso.
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ts_colab.area_id,
        (SELECT NULLIF(rr->>'centro_custo_id', '')::uuid
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
           WHERE NULLIF(rr->>'centro_custo_id', '') IS NOT NULL
           LIMIT 1)
      ) AS area_id
    ) ia ON true
    -- Revisor automático por centro de custo = coordenador da área do item.
    LEFT JOIN LATERAL (
      SELECT co.nome, co.foto_url, co.user_id
      FROM people.colaboradores co
      WHERE co.tenant_id = bi.tenant_id
        AND co.area_id = ia.area_id
        AND COALESCE(co.eh_coordenador, false) = true
      -- Áreas com mais de um coordenador (ex.: Societário): nunca sugerir o
      -- próprio autor do lançamento como revisor — ele fica por último e só é
      -- escolhido se for o único coordenador da área (feedback 20/07).
      ORDER BY (co.id = cs.responsavel_id) DESC, (co.user_id IS NOT DISTINCT FROM bi.created_by), co.nome
      LIMIT 1
    ) auto_rev ON (cs.timesheet_config->>'revisores_modo') = 'auto_centro_custo'
    LEFT JOIN people.colaboradores orig_colab
      ON orig_colab.user_id = bi.created_by
     AND orig_colab.tenant_id = bi.tenant_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'role', h.role,
            'author_id', h.author_id,
            'author_name', COALESCE(c_hist.nome, h.author_name),
            'horas', h.horas,
            'valor', h.valor,
            'texto', h.texto,
            'created_at', h.created_at
          ) ORDER BY h.created_at ASC
        ),
        '[]'::jsonb
      ) AS hist
      FROM finance.revisao_fatura_itens_historico h
      LEFT JOIN people.colaboradores c_hist
        ON c_hist.user_id = h.author_id AND c_hist.tenant_id = h.tenant_id
      WHERE h.billing_item_id = bi.id AND h.tenant_id = bi.tenant_id
    ) rfih ON true
    LEFT JOIN LATERAL (
      SELECT g.texto, g.horas_revisadas, g.valor_revisado
      FROM finance.billing_item_grupos g
      WHERE g.grupo_id = bi.grupo_id AND g.tenant_id = bi.tenant_id
    ) gr ON true
    LEFT JOIN people.areas ar_item ON ar_item.id = ia.area_id AND ar_item.tenant_id = bi.tenant_id
    WHERE bi.tenant_id = v_tenant_id
      AND bi.status NOT IN ('disponivel', 'cancelado', 'ignorado')
      AND (
        v_can_view_all
        -- responsável reatribuído da etapa vê o item mesmo de outro CC
        OR bi.responsavel_revisao_id = p_user_id
        OR bi.responsavel_aprovacao_id = p_user_id
        -- Revisor/aprovador CONFIGURADO no caso (timesheet_config) ou revisor
        -- automático por centro de custo: vê o item mesmo que o autor seja de
        -- outra área. Bruna Fedatto (Contratos) não via 12 itens de outubro em
        -- que era a revisora, lançados por gente do Tributário e do Contencioso
        -- (Filipe, 06/10). Vale para 7 revisores que não são sócios.
        OR rev_colab.user_id = p_user_id
        OR apr_colab.user_id = p_user_id
        OR auto_rev.user_id = p_user_id
        -- item de timesheet: área do autor = área do gestor
        OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_viewer_area_id)
        -- qualquer item: centro de custo (rateio) do caso inclui a área do gestor
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      AND (
        p_status IS NULL
        OR trim(p_status) = ''
        OR bi.status = trim(p_status)
      )
      -- Sem p_competencia: comportamento de sempre (todos os meses). A
      -- Composição e o fluxo antigo dependem disso.
      AND (
        v_competencia IS NULL
        OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
      )
      AND (
        p_cliente IS NULL
        OR trim(p_cliente) = ''
        OR cli.nome ILIKE '%' || trim(p_cliente) || '%'
      )
      AND (
        p_contrato IS NULL
        OR trim(p_contrato) = ''
        OR c.nome_contrato ILIKE '%' || trim(p_contrato) || '%'
        OR c.numero::text ILIKE '%' || trim(p_contrato) || '%'
      )
      AND (
        p_caso IS NULL
        OR trim(p_caso) = ''
        OR cs.nome ILIKE '%' || trim(p_caso) || '%'
        OR cs.numero::text ILIKE '%' || trim(p_caso) || '%'
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_notas_geradas(p_user_id uuid, p_status text DEFAULT NULL::text, p_tipo_documento text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_cliente_id uuid DEFAULT NULL::uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
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
        COALESCE(ct.numero_sequencial, ct.numero)        AS contrato_numero_sequencial,
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_contratos_dashboard_drill(p_tenant_id uuid, p_dim text, p_valor text, p_ref_month date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'crm', 'finance', 'people', 'operations'
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ms date := date_trunc('month', COALESCE(p_ref_month, v_now))::date;
  v_me date := (date_trunc('month', COALESCE(p_ref_month, v_now)) + interval '1 month')::date;
  v_mes date;
  v_result json;
BEGIN
  IF p_dim = 'por_cliente_top' THEN
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'numero_sequencial', COALESCE(ct.numero_sequencial, ct.numero), 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id AND ct.status = 'ativo' AND cli.nome = p_valor;
  ELSIF p_dim = 'por_mes' THEN
    -- Clique no gráfico de volume mensal (pedido Filipe 04/08). O front manda o
    -- mês como 'YYYY-MM'; aceitamos também 'YYYY-MM-DD' para chamadas diretas.
    v_mes := to_date(substr(p_valor, 1, 7) || '-01', 'YYYY-MM-DD');
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'numero_sequencial', COALESCE(ct.numero_sequencial, ct.numero), 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id
      AND date_trunc('month', ct.created_at AT TIME ZONE 'America/Sao_Paulo') = v_mes;
  ELSIF p_dim = 'por_status' THEN
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'numero_sequencial', COALESCE(ct.numero_sequencial, ct.numero), 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id AND COALESCE(ct.status, 'sem status') = p_valor;
  ELSE
    SELECT COALESCE(json_agg(json_build_object('contrato_id', ct.id, 'numero', ct.numero, 'numero_sequencial', COALESCE(ct.numero_sequencial, ct.numero), 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', c.nome) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.casos c
    JOIN contracts.contratos ct ON ct.id = c.contrato_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores p ON p.id = c.responsavel_id
    LEFT JOIN operations.categorias_servico sv ON sv.id = c.servico_id
    LEFT JOIN contracts.produtos pd ON pd.id = c.produto_id
    WHERE c.tenant_id = p_tenant_id AND c.parte_de_carteira_id IS NULL
      AND (
        (p_dim = 'por_responsavel' AND c.status='ativo' AND COALESCE(p.nome,'Sem responsável') = p_valor) OR
        (p_dim = 'por_servico'     AND c.status='ativo' AND COALESCE(sv.nome,'Sem serviço') = p_valor) OR
        (p_dim = 'por_produto'     AND c.status='ativo' AND COALESCE(pd.nome,'Sem produto') = p_valor) OR
        (p_dim = 'por_centro_custo' AND c.status='ativo' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.centro_custo_rateio)='array' THEN c.centro_custo_rateio ELSE '[]'::jsonb END
          ) rr
          LEFT JOIN people.areas ar2 ON ar2.id = NULLIF(rr->>'centro_custo_id','')::uuid
          WHERE COALESCE(ar2.nome, NULLIF(rr->>'centro_custo_nome',''), 'Sem centro de custo') = p_valor
        )) OR
        (p_dim = 'por_regra_cobranca_mes'
          AND COALESCE(NULLIF(c.regra_cobranca,''),'Sem regra') = p_valor
          AND c.created_at >= v_ms::timestamptz AND c.created_at < v_me::timestamptz)
      )
    LIMIT 200;
  END IF;

  RETURN v_result;
END;
$function$;
