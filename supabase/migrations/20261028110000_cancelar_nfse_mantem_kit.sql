-- Filipe 16/10, item 5: cancelar a NFS-e não devolve mais os itens para a
-- revisão. O kit fica na Composição como "Pendente", com os mesmos itens
-- aprovados, pronto para emitir a nota de novo. Voltar para a revisão passa a
-- ser só pelo botão "Devolver para revisão" (excluir_kit).
--
-- Onde estava: a edge cancelar-nfse marca a nota como cancelada e chama
-- bol_devolver_itens_da_nota, que mandava TODO item 'faturado' do caso (de
-- qualquer competência) para 'em_revisao' e as horas para 'revisao'. O nome
-- da função fica (é o que a edge publicada chama); muda o que ela faz.
--
-- 1) bol_devolver_itens_da_nota: os itens DA NOTA (metadata.item_ids) e as
--    despesas que foram no boleto dela (despesas_no_boleto) voltam de
--    'faturado' para 'aprovado' — o estado em que get_billing_items_aprovados_escopo
--    e criar_recebivel_da_nota os enxergam na reemissão. Item que outra NFS-e
--    viva ainda cobre (rateio: uma nota por pagador com os mesmos itens) fica
--    'faturado', para a reemissão não duplicar a nota do outro pagador.
--    Timesheets não mudam (seguem 'aprovado'). A conta a receber da nota é
--    cancelada como antes; boleto vivo segue as regras de sempre (só conta).
--    O kit perde o carimbo de finalizado (status volta a "Pendente"), mas
--    continua congelado: item_ids não muda.
-- 2) get_composicao_fatura: e-mail enviado com a NFS-e cancelada não conta
--    mais como "Enviado" — sem nota viva, o kit está pendente. Nada mais muda.

CREATE OR REPLACE FUNCTION public.bol_devolver_itens_da_nota(p_user_id uuid, p_nota_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'operations', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_ids uuid[];
  v_itens int := 0;
  v_kits int := 0;
  v_outra_viva boolean := false;
  v_lanc int := 0;
  v_boletos int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  SELECT * INTO v_nota FROM finance.billing_notes
   WHERE id = p_nota_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;

  -- Itens que a nota cobria: os de serviço (item_ids) e as despesas que
  -- entraram no boleto dela (criar_recebivel_da_nota as marcou 'faturado').
  SELECT COALESCE(array_agg(DISTINCT x.value::uuid), '{}') INTO v_ids
    FROM (
      SELECT jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(v_nota.metadata->'item_ids') = 'array'
                    THEN v_nota.metadata->'item_ids' ELSE '[]'::jsonb END) AS value
      UNION ALL
      SELECT jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(v_nota.metadata->'despesas_no_boleto'->'item_ids') = 'array'
                    THEN v_nota.metadata->'despesas_no_boleto'->'item_ids' ELSE '[]'::jsonb END)
    ) x;

  -- Filipe 16/10: o kit continua na Composição. Os itens voltam a 'aprovado'
  -- (prontos para a nova NFS-e), não para a revisão. Fica 'faturado' o item
  -- que outra NFS-e viva ainda cobre (rateio de pagadores).
  UPDATE finance.billing_items bi
     SET status = 'aprovado', updated_at = now(), updated_by = p_user_id
   WHERE bi.tenant_id = v_tenant
     AND bi.status = 'faturado'
     AND bi.id = ANY (v_ids)
     AND NOT EXISTS (
       SELECT 1
         FROM finance.billing_notes o
        WHERE o.tenant_id = v_tenant
          AND o.id <> v_nota.id
          AND o.tipo_documento = 'nota_fiscal_servico'
          AND o.status = 'gerado'
          AND COALESCE(o.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
          AND (
            o.metadata->'item_ids' @> to_jsonb(bi.id::text)
            OR o.metadata->'despesas_no_boleto'->'item_ids' @> to_jsonb(bi.id::text)
          )
     );
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  -- Sem nota viva o kit volta a "Pendente": sai o carimbo de finalizado, mas
  -- o kit segue congelado (item_ids intacto) — os mesmos itens, e o que foi
  -- aprovado depois continua no bloco à parte. Com outra NFS-e viva sobre os
  -- mesmos itens (rateio), o kit ainda tem nota e fica como está.
  SELECT EXISTS (
    SELECT 1
      FROM finance.billing_notes o
     WHERE o.tenant_id = v_tenant
       AND o.id <> v_nota.id
       AND o.tipo_documento = 'nota_fiscal_servico'
       AND o.status = 'gerado'
       AND COALESCE(o.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(o.metadata->'item_ids', '[]'::jsonb)) x
          WHERE x.value::uuid = ANY (v_ids))
  ) INTO v_outra_viva;

  IF NOT v_outra_viva THEN
    UPDATE finance.kits k
       SET finalizado_em = NULL, finalizado_por = NULL, finalizado_obs = NULL,
           updated_at = now()
      FROM (
        SELECT DISTINCT a.contrato_id, a.caso_id, a.competencia, a.kit_sequencia
          FROM finance.kit_atribuicao(v_tenant, v_nota.contrato_id) a
         WHERE a.item_id = ANY (v_ids) AND NOT a.pendente
      ) a
     WHERE k.tenant_id = v_tenant
       AND k.finalizado_em IS NOT NULL
       AND k.contrato_id = a.contrato_id
       AND k.caso_id IS NOT DISTINCT FROM a.caso_id
       AND k.competencia = a.competencia
       AND k.sequencia = a.kit_sequencia;
    GET DIAGNOSTICS v_kits = ROW_COUNT;
  END IF;

  -- Conta a receber da nota: cancela, a menos que ja tenha sido recebida.
  UPDATE finance.lancamentos l
     SET status = 'cancelado', updated_at = now()
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento'
     AND l.origem_ref_id = p_nota_id
     AND l.status NOT IN ('cancelado', 'recebido', 'pago');
  GET DIAGNOSTICS v_lanc = ROW_COUNT;

  SELECT count(*) INTO v_boletos
    FROM finance.boletos b
    JOIN finance.lancamentos l ON l.id = b.lancamento_id
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento'
     AND l.origem_ref_id = p_nota_id
     AND b.status = 'registrado';

  RETURN jsonb_build_object(
    -- Nada volta mais para a revisão; as chaves antigas ficam em 0 para quem
    -- ainda lê o retorno antigo.
    'itens_devolvidos', 0,
    'horas_devolvidas', 0,
    'itens_liberados', v_itens,
    'kits_reabertos', v_kits,
    'contas_canceladas', v_lanc,
    'boletos_registrados', v_boletos
  );
END $function$;

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

  -- Filipe 16/10 (Osul, caso 1954): kit finalizado fica congelado. Em que
  -- kit cada item está vem de finance.kit_atribuicao — a mesma regra da
  -- NFS-e, do recebível e do e-mail. Item aprovado depois de finalizar
  -- (pendente) não entra em kit: vira o bloco pos_finalizacao do caso.
  WITH atr AS (
    SELECT * FROM finance.kit_atribuicao(v_tenant)
  ),
  itens AS (
    SELECT bi.id, bi.contrato_id, bi.caso_id, bi.origem_tipo, bi.origem_id, bi.status,
           a.kit_sequencia, a.pendente,
           bi.data_referencia, bi.snapshot, bi.created_at,
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date AS competencia,
           -- Mesmo valor que vai na NFS-e (get_billing_items_aprovados_full).
           COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)::numeric AS valor,
           -- Horas de TODO item de timesheet, valha ele R$ 0 ou não (6.2).
           CASE WHEN bi.origem_tipo = 'timesheet'
                THEN COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0)
                ELSE 0 END::numeric AS horas
      FROM finance.billing_items bi
      JOIN atr a ON a.item_id = bi.id
     WHERE bi.tenant_id = v_tenant
       AND bi.status IN ('aprovado', 'faturado')
  ),
  -- Chave do kit 1 igual à de sempre; kit separado ganha '|k<n>'; o bloco dos
  -- aprovados depois de finalizar, '|pos'.
  itens_todos AS (
    SELECT i.*,
           COALESCE(i.caso_id::text, 'contrato:' || i.contrato_id::text) || '|' || i.competencia::text AS grupo,
           COALESCE(i.caso_id::text, 'contrato:' || i.contrato_id::text) || '|' || i.competencia::text
             || CASE WHEN i.pendente THEN '|pos'
                     WHEN i.kit_sequencia > 1 THEN '|k' || i.kit_sequencia::text
                     ELSE '' END AS chave
      FROM itens i
  ),
  itens_chave AS (
    SELECT * FROM itens_todos WHERE NOT pendente
  ),
  kits AS (
    SELECT ic.chave, ic.grupo, ic.caso_id, ic.contrato_id, ic.competencia, ic.kit_sequencia,
           array_agg(ic.id) AS item_ids,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN 0 ELSE ic.valor END), 2) AS valor_servico,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN ic.valor ELSE 0 END), 2) AS valor_despesa,
           round(sum(ic.horas), 2) AS horas,
           count(*) FILTER (WHERE ic.origem_tipo = 'timesheet') AS lancamentos_timesheet,
           round(sum(ic.valor), 2) AS valor_total
      FROM itens_chave ic
     GROUP BY ic.chave, ic.grupo, ic.caso_id, ic.contrato_id, ic.competencia, ic.kit_sequencia
  ),
  -- A NFS-e cobre um kit por vez (get_billing_items_aprovados_escopo): o de
  -- menor sequência com serviço ainda aprovado. Os seguintes esperam.
  grupo_nfse AS (
    SELECT ic.grupo, min(ic.kit_sequencia) AS primeiro
      FROM itens_chave ic
     WHERE ic.status = 'aprovado' AND ic.origem_tipo <> 'despesa'
     GROUP BY ic.grupo
  ),
  pos AS (
    SELECT it.grupo,
           count(*) AS itens,
           round(sum(CASE WHEN it.origem_tipo = 'despesa' THEN 0 ELSE it.valor END), 2) AS valor_servico,
           round(sum(CASE WHEN it.origem_tipo = 'despesa' THEN it.valor ELSE 0 END), 2) AS valor_despesa,
           round(sum(it.horas), 2) AS horas,
           count(*) FILTER (WHERE it.origem_tipo = 'timesheet') AS lancamentos_timesheet,
           round(sum(it.valor), 2) AS valor_total
      FROM itens_todos it
     WHERE it.pendente
     GROUP BY it.grupo
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
           kn.chave, bn.id, bn.numero, bn.numero_documento, bn.status, bn.focus_status, bn.caso_id,
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
    SELECT kn.chave, bn.id, bn.numero, bn.numero_documento, bn.status, bn.focus_status, bn.arquivo_url,
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
             'id', nv.id, 'numero', nv.numero, 'numero_documento', nv.numero_documento,
             'nfse_numero', nv.nfse_numero,
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
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = k.kit_sequencia
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
           k.chave, bn.tipo_documento, bn.id, bn.numero_documento, bn.created_at, bn.arquivo_nome, bn.arquivo_url,
           COALESCE(NULLIF(bn.metadata->>'gerado_por_nome', ''), c.nome) AS gerado_por
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
       AND bn.status = 'gerado'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = k.kit_sequencia
      LEFT JOIN people.colaboradores c ON c.user_id = bn.created_by AND c.tenant_id = v_tenant
     ORDER BY k.chave, bn.tipo_documento, bn.created_at DESC
  ),
  -- Estado do kit (24/09): carimbo de finalizado e ajustes desta competência.
  -- Nome do pagador e do grupo resolvidos na hora (o cadastro pode ter mudado
  -- depois que o ajuste foi salvo).
  kit_estado AS (
    SELECT k.chave,
           fk.finalizado_em, fk.finalizado_obs,
           (fk.item_ids IS NOT NULL) AS congelado,
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
       AND fk.sequencia = k.kit_sequencia
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
           nf.id AS nfse_id, nf.numero AS nfse_numero_interno, nf.numero_documento AS nfse_numero_documento,
           nf.nfse_numero, nf.status AS nfse_status,
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
           -- Kit separado (Filipe 16/10) não entra em nota única: a nota do
           -- contrato cobre o kit 1 de cada caso.
           CASE WHEN k.kit_sequencia > 1 THEN 1 ELSE
           count(*) FILTER (
             WHERE k.valor_servico > 0
               AND k.kit_sequencia = 1
               AND NOT COALESCE(nf.status = 'gerado' AND COALESCE(nf.focus_status, '') NOT IN ('erro', 'erro_autorizacao'), false)
           ) OVER (PARTITION BY k.contrato_id, k.competencia) END AS irmaos_no_contrato,
           max(k.kit_sequencia) OVER (PARTITION BY k.grupo) AS ultima_sequencia,
           (gn.primeiro IS NOT NULL AND gn.primeiro < k.kit_sequencia) AS nfse_aguarda_kit_anterior,
           COALESCE(ke.congelado, false) AS congelado,
           CASE
             WHEN (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END) IN ('pago', 'recebido')
               OR (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END) IS NOT NULL
             THEN CASE
                    -- Mais de um pagador: recebido só com TODAS as contas pagas.
                    WHEN COALESCE(kns.n, 0) > 1 AND NOT kns.todas_pagas THEN
                      CASE
                        WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
                        WHEN COALESCE(env.algum_ok, false) AND nf.status = 'gerado' THEN 'enviado'
                        WHEN nf.status = 'gerado' AND nf.focus_status IN ('autorizado', 'processando') THEN 'nf_emitida'
                        ELSE 'pendente'
                      END
                    ELSE 'recebido'
                  END
             WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
             -- Filipe 16/10: e-mail que levou uma NFS-e depois cancelada não
             -- deixa o kit "Enviado" — sem nota viva ele está pendente.
             WHEN COALESCE(env.algum_ok, false) AND nf.status = 'gerado' THEN 'enviado'
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
      LEFT JOIN grupo_nfse gn ON gn.grupo = k.grupo
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
      FROM itens_todos ic
     WHERE ic.chave IN (SELECT f.chave FROM filtrado f)
        OR ic.chave IN (SELECT f.grupo || '|pos' FROM filtrado f WHERE f.kit_sequencia = f.ultima_sequencia)
     GROUP BY ic.chave
  ),
  casos_json AS (
    SELECT f.cliente_id, f.cliente_nome, f.valor_total, f.contrato_numero, f.caso_numero,
           jsonb_build_object(
             'chave', f.chave,
             'kit_sequencia', f.kit_sequencia,
             'congelado', f.congelado,
             'nfse_aguarda_kit_anterior', f.nfse_aguarda_kit_anterior,
             -- Aprovados depois de finalizar (Filipe 16/10): vão no último kit
             -- do caso+competência. Unificar = reabrir esse kit, só sem NFS-e
             -- autorizada/processando e sem boleto vivo (motivo_bloqueio).
             'pos_finalizacao', CASE WHEN p.grupo IS NULL THEN NULL ELSE jsonb_build_object(
               'chave', p.grupo || '|pos',
               'itens_count', p.itens,
               'valor_servico', p.valor_servico,
               'valor_despesa', p.valor_despesa,
               'horas', p.horas,
               'lancamentos_timesheet', p.lancamentos_timesheet,
               'valor_total', p.valor_total,
               'itens', COALESCE(pj.itens, '[]'::jsonb),
               'pode_unificar', (f.motivo_bloqueio IS NULL),
               'motivo_nao_unificar', f.motivo_bloqueio) END,
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
                 'id', f.nfse_id, 'numero', f.nfse_numero_interno, 'numero_documento', f.nfse_numero_documento,
                 'nfse_numero', f.nfse_numero,
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
                 SELECT jsonb_build_object('id', d.id, 'numero_documento', d.numero_documento,
                                           'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'relatorio_timesheet'),
               'nota_debito', (
                 SELECT jsonb_build_object('id', d.id, 'numero_documento', d.numero_documento,
                                           'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
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
      LEFT JOIN pos p ON p.grupo = f.grupo AND f.kit_sequencia = f.ultima_sequencia
      LEFT JOIN itens_json pj ON pj.chave = f.grupo || '|pos' AND f.kit_sequencia = f.ultima_sequencia
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
      'pos_finalizacao', (
        SELECT jsonb_build_object('blocos', count(*), 'itens', COALESCE(sum(p.itens), 0),
                                  'valor', COALESCE(round(sum(p.valor_total), 2), 0))
          FROM filtrado f JOIN pos p ON p.grupo = f.grupo
         WHERE f.kit_sequencia = f.ultima_sequencia),
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
