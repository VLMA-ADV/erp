-- Rateio das despesas entre pagadores (Filipe 29/10: "Vários pagadores!").
--
-- Kit só de despesas com mais de um pagador (ajuste do kit ou rateio do caso)
-- passa a ter UMA nota de débito por pagador, cada uma com a parte dele,
-- conta a receber e boleto próprios. Kit com honorários não muda: as despesas
-- vão no boleto da NFS-e de cada pagador.
--
--  * salvar_ajustes_kit: o kit de despesas separado aceita vários pagadores.
--  * criar_recebivel_da_nota_debito: ND com `parte_despesas` cobra a parte.
--  * registrar_notas_debito_rateio: registra as NDs do rateio numa transação.
--  * get_composicao_fatura: documentos.notas_debito (uma por pagador).
--  * get_dados_envio_fatura: o e-mail leva todas as NDs vivas do kit.

CREATE OR REPLACE FUNCTION public.salvar_ajustes_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_ajustes jsonb, p_salvar_no_cadastro boolean DEFAULT false, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_grupo_id uuid;
  v_grupo_nome text;
  v_pagadores jsonb;          -- [{cliente_id, nome, percentual}] para o kit
  v_pagadores_cadastro jsonb; -- [{cliente_id, percentual}] para o cadastro
  v_soma numeric;
  v_ajustes jsonb;
  v_cadastro jsonb := NULL;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o kit';
  END IF;
  IF p_ajustes IS NOT NULL AND jsonb_typeof(p_ajustes) <> 'object' THEN
    RAISE EXCEPTION 'Ajustes inválidos';
  END IF;

  -- Grupo de impostos: tem de existir no tenant.
  v_grupo_id := NULLIF(p_ajustes->>'grupo_imposto_id', '')::uuid;
  IF v_grupo_id IS NOT NULL THEN
    SELECT gi.nome INTO v_grupo_nome FROM contracts.grupos_impostos gi
     WHERE gi.id = v_grupo_id AND gi.tenant_id = v_tenant;
    IF v_grupo_nome IS NULL THEN RAISE EXCEPTION 'Grupo de impostos não encontrado'; END IF;
  END IF;

  -- Pagadores: clientes do tenant, percentuais fechando 100%.
  IF jsonb_typeof(p_ajustes->'pagadores') = 'array' AND jsonb_array_length(p_ajustes->'pagadores') > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('cliente_id', pg.cliente_id, 'nome', c.nome, 'percentual', pg.percentual)
                     ORDER BY pg.percentual DESC, c.nome),
           jsonb_agg(jsonb_build_object('cliente_id', pg.cliente_id, 'percentual', pg.percentual)
                     ORDER BY pg.percentual DESC, c.nome),
           sum(pg.percentual)
      INTO v_pagadores, v_pagadores_cadastro, v_soma
      FROM (
        SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
               round(COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 0), 2) AS percentual
          FROM jsonb_array_elements(p_ajustes->'pagadores') p
      ) pg
      LEFT JOIN crm.clientes c ON c.id = pg.cliente_id AND c.tenant_id = v_tenant;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_ajustes->'pagadores') p
      LEFT JOIN crm.clientes c ON c.id = NULLIF(p.value->>'cliente_id', '')::uuid AND c.tenant_id = v_tenant
      WHERE c.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Pagador não encontrado entre os clientes';
    END IF;
    IF abs(v_soma - 100) > 0.01 THEN
      RAISE EXCEPTION 'Os percentuais dos pagadores somam %, precisam somar 100%%', v_soma;
    END IF;
  END IF;

  -- Kit só de despesas separado dos honorários (Filipe 28/10, Gramarcal): os
  -- pagadores do cadastro (pagadores_servico) são os dos honorários — gravar
  -- lá os das despesas mudaria a NFS-e dos meses seguintes. Vários pagadores
  -- valem desde 29/10 (Filipe: "Vários pagadores!"): uma nota de débito e um
  -- boleto por pagador (registrar_notas_debito_rateio).
  IF finance._kit_conteudo(v_tenant, p_contrato_id, p_caso_id, date_trunc('month', p_competencia)::date,
                           COALESCE(p_kit_sequencia, 1)) = 'despesas' THEN
    IF p_salvar_no_cadastro THEN
      RAISE EXCEPTION 'O pagador do kit de despesas vale só para este kit: o cadastro do caso guarda os pagadores dos honorários.';
    END IF;
  END IF;

  -- Ajuste vale para o kit da tela (kit separado tem o seu, Filipe 16/10).
  v_id := finance._kit_upsert(v_tenant, p_contrato_id, p_caso_id, p_competencia, COALESCE(p_kit_sequencia, 1)::smallint);

  v_ajustes := CASE WHEN v_grupo_id IS NULL AND v_pagadores IS NULL THEN NULL
               ELSE jsonb_build_object('grupo_imposto_id', v_grupo_id, 'pagadores', v_pagadores) END;

  UPDATE finance.kits
     SET ajustes = v_ajustes,
         ajustes_atualizado_em = now(),
         ajustes_por = p_user_id,
         updated_at = now()
   WHERE id = v_id;

  IF p_salvar_no_cadastro AND (v_grupo_id IS NOT NULL OR v_pagadores_cadastro IS NOT NULL) THEN
    v_cadastro := public.aplicar_ajustes_no_cadastro(
      p_user_id, p_contrato_id, p_caso_id, v_pagadores_cadastro, v_grupo_id, NULL, NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kit_id', v_id,
    'ajustes_kit', CASE WHEN v_ajustes IS NULL THEN NULL ELSE jsonb_build_object(
      'grupo_imposto_id', v_grupo_id, 'grupo_imposto_nome', v_grupo_nome, 'pagadores', v_pagadores) END,
    'alterado_no_cadastro', (v_cadastro IS NOT NULL
                             AND jsonb_array_length(COALESCE(v_cadastro->'alterado', '[]'::jsonb)) > 0),
    'alterado', COALESCE(v_cadastro->'alterado', '[]'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota_debito(p_nota_debito_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_competencia date;
  v_item_ids uuid[] := '{}';
  v_ids uuid[] := '{}';
  v_despesas numeric := 0;
  v_pagador uuid;
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_debito_id;
  IF NOT FOUND OR v_nota.tipo_documento <> 'nota_debito' OR v_nota.status <> 'gerado' THEN
    RETURN NULL;
  END IF;

  v_competencia := date_trunc('month', NULLIF(v_nota.metadata->>'competencia', '')::date)::date;
  IF v_competencia IS NULL THEN RETURN NULL; END IF;

  -- Idempotente: já tem conta a receber viva nesta nota de débito.
  IF EXISTS (
    SELECT 1 FROM finance.lancamentos l
     WHERE l.tenant_id = v_nota.tenant_id AND l.origem = 'faturamento'
       AND l.origem_ref_id = v_nota.id AND l.status <> 'cancelado'
  ) THEN
    RETURN NULL;
  END IF;

  -- Kit COM serviço: as despesas vão no boleto da NFS-e (criar_recebivel_da_nota),
  -- como hoje. "Serviço" é item que não é despesa e VALE alguma coisa — o caso
  -- 360 tem oito lançamentos de timesheet a R$ 0 (horas sem cobrança) e é
  -- justamente o kit que motivou o pedido; só o origem_tipo não basta.
  -- "Kit" = o desta nota de débito (Filipe 16/10: kit separado tem o seu;
  -- serviço aprovado depois de finalizar não conta).
  IF EXISTS (
    SELECT 1 FROM finance.billing_items bi
      JOIN finance.kit_atribuicao(v_nota.tenant_id, v_nota.contrato_id) a ON a.item_id = bi.id
     WHERE bi.tenant_id = v_nota.tenant_id
       AND bi.contrato_id = v_nota.contrato_id
       AND bi.caso_id IS NOT DISTINCT FROM v_nota.caso_id
       AND bi.status IN ('aprovado', 'faturado')
       AND bi.origem_tipo <> 'despesa'
       AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
       AND COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) > 0
       AND NOT a.pendente
       AND a.kit_sequencia = COALESCE(NULLIF(v_nota.metadata->>'kit_sequencia', '')::int, 1)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(x.value::uuid), '{}') INTO v_item_ids
    FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x;

  -- Despesas aprovadas da nota de débito. 'faturado' fica de fora de propósito:
  -- é a marca de "já está numa conta a receber" (NFS-e ou ND anterior).
  SELECT COALESCE(array_agg(bi.id), '{}'),
         COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)), 0)
    INTO v_ids, v_despesas
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_nota.tenant_id
     AND bi.id = ANY (v_item_ids)
     AND bi.origem_tipo = 'despesa'
     AND bi.status = 'aprovado';

  -- Rateio das despesas (Filipe 29/10): uma ND por pagador, cada uma com a
  -- sua parte (registrar_notas_debito_rateio grava `parte_despesas`). As
  -- despesas são as mesmas em todas: a primeira ND as marca 'faturado', as
  -- outras as encontram assim — por isso aqui vale 'faturado' também.
  IF v_nota.metadata ? 'parte_despesas' THEN
    SELECT COALESCE(array_agg(bi.id), '{}') INTO v_ids
      FROM finance.billing_items bi
     WHERE bi.tenant_id = v_nota.tenant_id
       AND bi.id = ANY (v_item_ids)
       AND bi.origem_tipo = 'despesa'
       AND bi.status IN ('aprovado', 'faturado');
    v_despesas := NULLIF(v_nota.metadata->>'parte_despesas', '')::numeric;
    IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF v_despesas <= 0 THEN RETURN NULL; END IF;

  -- Quem paga (Filipe 28/10, Gramarcal: "alterar o pagador especificamente
  -- da despesa"): o pagador da nota, se veio; senão o pagador ÚNICO
  -- ajustado no kit desta ND (salvar_ajustes_kit). Sem ajuste, o cliente do
  -- contrato, como sempre. Com vários pagadores no ajuste continua o cliente
  -- do contrato: a ND gera uma conta só (ver relatório 28/10).
  v_pagador := NULLIF(v_nota.metadata->>'pagador_cliente_id', '')::uuid;
  IF v_pagador IS NULL THEN
    SELECT NULLIF(k.ajustes->'pagadores'->0->>'cliente_id', '')::uuid INTO v_pagador
      FROM finance.kits k
     WHERE k.tenant_id = v_nota.tenant_id
       AND k.contrato_id = v_nota.contrato_id
       AND k.caso_id IS NOT DISTINCT FROM v_nota.caso_id
       AND k.competencia = v_competencia
       AND k.sequencia = COALESCE(NULLIF(v_nota.metadata->>'kit_sequencia', '')::int, 1)
       AND jsonb_typeof(k.ajustes->'pagadores') = 'array'
       AND jsonb_array_length(k.ajustes->'pagadores') = 1;
  END IF;

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', COALESCE(v_pagador, ct.cliente_id),
    'Despesas — ' || COALESCE(cli.nome, 'cliente') || COALESCE(' (ND #' || v_nota.numero || ')', '')
      || COALESCE(' · ' || (SELECT CASE WHEN p = trunc(p) THEN trunc(p)::text
                                        ELSE replace(rtrim(round(p, 2)::text, '0'), '.', ',') END
                              FROM (SELECT NULLIF(v_nota.metadata->>'percentual', '')::numeric AS p) x) || '%', ''),
    round(v_despesas, 2),
    -- Mesma regra de vencimento da NFS-e (dia de pagamento do caso/contrato,
    -- ou +7 dias); vencimento_override no metadata também vale.
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  LEFT JOIN crm.clientes cli ON cli.id = COALESCE(v_pagador, ct.cliente_id)
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY (v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', round(v_despesas, 2), 'lancamento_id', v_id,
               'pagador_cliente_id', v_pagador))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $function$;


-- Uma nota de débito por pagador num kit só de despesas (Filipe 29/10:
-- "Vários pagadores!"). O front monta um PDF por pagador (destinatário, a
-- parte dele e a divisão completa) e manda tudo junto; aqui, numa transação:
-- sai(em) a(s) ND(s) viva(s) do kit e as contas delas, entram as novas, cada
-- uma com a sua conta a receber (criar_recebivel_da_nota_debito, pela parte).
-- p_notas: [{pagador_cliente_id, percentual, valor, arquivo_nome, arquivo_url}]
CREATE OR REPLACE FUNCTION public.registrar_notas_debito_rateio(
  p_user_id uuid,
  p_caso_id uuid,
  p_contrato_id uuid,
  p_competencia date,
  p_kit_sequencia integer,
  p_item_ids uuid[],
  p_notas jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_seq int := COALESCE(p_kit_sequencia, 1);
  v_nome text;
  v_total numeric;
  v_soma numeric;
  v_perc numeric;
  v_id uuid;
  v_lanc uuid;
  v_out jsonb := '[]'::jsonb;
  n jsonb;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para registrar documentos do kit';
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
     WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant AND cs.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado no contrato';
  END IF;

  IF jsonb_typeof(p_notas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_notas) < 2 THEN
    RAISE EXCEPTION 'O rateio das despesas precisa de pelo menos dois pagadores';
  END IF;
  IF (SELECT count(DISTINCT x->>'pagador_cliente_id') FROM jsonb_array_elements(p_notas) x
       WHERE NULLIF(x->>'pagador_cliente_id', '') IS NOT NULL) <> jsonb_array_length(p_notas) THEN
    RAISE EXCEPTION 'Cada nota de débito do rateio precisa de um pagador diferente';
  END IF;
  SELECT sum(NULLIF(x->>'percentual', '')::numeric), sum(NULLIF(x->>'valor', '')::numeric)
    INTO v_perc, v_soma FROM jsonb_array_elements(p_notas) x;
  IF abs(COALESCE(v_perc, 0) - 100) > 0.01 THEN
    RAISE EXCEPTION 'Os percentuais dos pagadores somam %, precisam somar 100%%', v_perc;
  END IF;

  -- Só kit SEM serviço: com serviço as despesas vão no boleto da NFS-e (a
  -- mesma regra de criar_recebivel_da_nota_debito).
  IF EXISTS (
    SELECT 1 FROM finance.billing_items bi
      JOIN finance.kit_atribuicao(v_tenant, p_contrato_id) a ON a.item_id = bi.id
     WHERE bi.tenant_id = v_tenant
       AND bi.caso_id = p_caso_id
       AND bi.status IN ('aprovado', 'faturado')
       AND bi.origem_tipo <> 'despesa'
       AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
       AND COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) > 0
       AND NOT a.pendente
       AND a.kit_sequencia = v_seq
  ) THEN
    RAISE EXCEPTION 'Este kit tem honorários: as despesas vão no boleto da NFS-e, por pagador. A divisão da nota de débito vale para kit só de despesas.';
  END IF;

  -- Conta já no banco (boleto vivo) ou recebida: não se refaz a divisão.
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
                                AND l.status <> 'cancelado'
     WHERE bn.tenant_id = v_tenant AND bn.tipo_documento = 'nota_debito' AND bn.status = 'gerado'
       AND bn.contrato_id = p_contrato_id AND bn.caso_id = p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
       AND (l.status IN ('pago', 'recebido') OR l.baixa_data IS NOT NULL
            OR EXISTS (SELECT 1 FROM finance.boletos b
                        WHERE b.lancamento_id = l.id AND b.status NOT IN ('cancelado', 'erro', 'baixado')))
  ) THEN
    RAISE EXCEPTION 'A nota de débito deste kit já tem boleto registrado no banco (ou a conta já foi recebida). Cancele o boleto antes de dividir entre pagadores.';
  END IF;

  -- Sai o que estava: contas das NDs vivas (despesas voltam a 'aprovado') e as NDs.
  FOR r IN
    SELECT l.id AS lanc_id, bn.metadata->'despesas_no_boleto'->'item_ids' AS item_ids
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
                                AND l.status <> 'cancelado'
     WHERE bn.tenant_id = v_tenant AND bn.tipo_documento = 'nota_debito' AND bn.status = 'gerado'
       AND bn.contrato_id = p_contrato_id AND bn.caso_id = p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
  LOOP
    UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now() WHERE id = r.lanc_id;
    UPDATE finance.billing_items bi
       SET status = 'aprovado', updated_at = now()
     WHERE bi.tenant_id = v_tenant AND bi.status = 'faturado' AND bi.origem_tipo = 'despesa'
       AND bi.id IN (SELECT x.value::uuid FROM jsonb_array_elements_text(COALESCE(r.item_ids, '[]'::jsonb)) x);
  END LOOP;
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant AND bn.tipo_documento = 'nota_debito' AND bn.status = 'gerado'
     AND bn.contrato_id = p_contrato_id AND bn.caso_id = p_caso_id
     AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq;

  -- As partes têm de fechar o total das despesas aprovadas (o PDF imprime as mesmas).
  SELECT COALESCE(sum(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)), 0)
    INTO v_total
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_tenant AND bi.id = ANY (p_item_ids)
     AND bi.origem_tipo = 'despesa' AND bi.status = 'aprovado';
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Nenhuma despesa aprovada neste kit para dividir';
  END IF;
  IF round(COALESCE(v_soma, 0), 2) <> round(v_total, 2) THEN
    RAISE EXCEPTION 'As partes dos pagadores (R$ %) não fecham o total das despesas (R$ %). Atualize a tela e gere de novo.',
      round(COALESCE(v_soma, 0), 2), round(v_total, 2);
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  FOR n IN SELECT x FROM jsonb_array_elements(p_notas) WITH ORDINALITY t(x, o) ORDER BY o LOOP
    INSERT INTO finance.billing_notes (
      tenant_id, contrato_id, caso_id, tipo_documento, status,
      arquivo_nome, arquivo_url, metadata, created_by
    ) VALUES (
      v_tenant, p_contrato_id, p_caso_id, 'nota_debito', 'gerado',
      n->>'arquivo_nome', n->>'arquivo_url',
      (COALESCE(p_metadata, '{}'::jsonb) - 'kit_sequencia' - 'reimpressao_de' - 'despesas_no_boleto') || jsonb_build_object(
        'item_ids', COALESCE(to_jsonb(p_item_ids), '[]'::jsonb),
        'competencia', v_competencia,
        'gerado_por_nome', COALESCE(v_nome, 'Usuário'),
        'pagador_cliente_id', n->>'pagador_cliente_id',
        'percentual', NULLIF(n->>'percentual', '')::numeric,
        'parte_despesas', round(NULLIF(n->>'valor', '')::numeric, 2)
      ) || CASE WHEN v_seq > 1 THEN jsonb_build_object('kit_sequencia', v_seq) ELSE '{}'::jsonb END,
      p_user_id
    ) RETURNING id INTO v_id;
    -- nº de documento: o trigger usa (tipo, contrato, caso, competência, PAGADOR).
    v_lanc := finance.criar_recebivel_da_nota_debito(v_id, p_user_id);
    v_out := v_out || jsonb_build_object(
      'id', v_id, 'lancamento_id', v_lanc,
      'pagador_cliente_id', n->>'pagador_cliente_id',
      'numero_documento', (SELECT bn.numero_documento FROM finance.billing_notes bn WHERE bn.id = v_id));
  END LOOP;

  RETURN jsonb_build_object('notas', v_out);
END $function$;

REVOKE ALL ON FUNCTION public.registrar_notas_debito_rateio(uuid, uuid, uuid, date, integer, uuid[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_notas_debito_rateio(uuid, uuid, uuid, date, integer, uuid[], jsonb, jsonb) TO authenticated, service_role;

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
  -- Filipe 16/10 / Jessika 28/10: pendências do CONTRATO na competência
  -- (fila, revisão, aprovação) — bolinha verde/vermelha e a trava do
  -- Finalizar. Só com competência escolhida: sem ela (badges das abas) a
  -- fila de cada mês custaria uma volta de get_itens_a_faturar por mês.
  pend AS (
    SELECT * FROM finance.pendencias_contratos(p_user_id, v_competencia)
     WHERE v_competencia IS NOT NULL
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
  -- Rateio das despesas (Filipe 29/10): NDs vivas do kit, uma por pagador,
  -- cada uma com a conta a receber e o boleto dela (como kit_nfses).
  kit_nds_vivas AS (
    SELECT kn.chave, bn.id, bn.numero_documento, bn.arquivo_url, bn.created_at,
           NULLIF(bn.metadata->>'percentual', '')::numeric AS percentual,
           COALESCE(NULLIF(bn.metadata->>'parte_despesas', '')::numeric,
                    NULLIF(bn.metadata->'despesas_no_boleto'->>'valor', '')::numeric) AS valor,
           COALESCE(NULLIF(bn.metadata->>'pagador_cliente_id', '')::uuid, ct.cliente_id) AS pagador_id
      FROM kit_nd_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
      JOIN kits k ON k.chave = kn.chave
      JOIN contracts.contratos ct ON ct.id = k.contrato_id
     WHERE bn.status = 'gerado' AND bn.metadata ? 'parte_despesas'
  ),
  kit_nds_lanc AS (
    SELECT DISTINCT ON (nv.id)
           nv.id AS nota_id, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nds_vivas nv
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = nv.id
     ORDER BY nv.id, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_nds_boleto AS (
    SELECT DISTINCT ON (nl.id)
           nl.id AS lanc_id, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_nds_lanc nl
      JOIN finance.boletos b ON b.lancamento_id = nl.id
     ORDER BY nl.id, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  kit_nds AS (
    SELECT nv.chave,
           count(*) AS n,
           bool_and(COALESCE(nl.status IN ('pago', 'recebido') OR nl.baixa_data IS NOT NULL, false)) AS todas_pagas,
           jsonb_agg(jsonb_build_object(
             'id', nv.id, 'numero_documento', nv.numero_documento, 'arquivo_url', nv.arquivo_url,
             'gerado_em', nv.created_at, 'percentual', nv.percentual, 'valor', nv.valor,
             'pagador', jsonb_build_object('cliente_id', nv.pagador_id, 'nome', pc.nome),
             'conta_receber', CASE WHEN nl.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', nl.id, 'valor', nl.valor, 'vencimento', nl.vencimento,
               'status', nl.status, 'pago_em', nl.baixa_data) END,
             'boleto', CASE WHEN nb.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', nb.id, 'status', nb.status, 'vencimento', nb.vencimento,
               'valor', nb.valor, 'linha_digitavel', nb.linha_digitavel,
               'nosso_numero', nb.nosso_numero, 'pix_emv', nb.pix_copia_cola) END
           ) ORDER BY nv.percentual DESC NULLS LAST, pc.nome) AS nds
      FROM kit_nds_vivas nv
      LEFT JOIN crm.clientes pc ON pc.id = nv.pagador_id
      LEFT JOIN kit_nds_lanc nl ON nl.nota_id = nv.id
      LEFT JOIN kit_nds_boleto nb ON nb.lanc_id = nl.id
     GROUP BY nv.chave
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
  -- Filipe 28/10 (Gramarcal): honorários e despesas faturados em kits
  -- separados do mesmo caso+competência. Separação ativa = o grupo tem um kit
  -- 'honorarios' E um 'despesas' (a mesma regra de finance.kit_atribuicao).
  grupo_separado AS (
    SELECT fk.contrato_id, fk.caso_id, fk.competencia
      FROM finance.kits fk
     WHERE fk.tenant_id = v_tenant AND fk.conteudo IS NOT NULL
     GROUP BY fk.contrato_id, fk.caso_id, fk.competencia
    HAVING bool_or(fk.conteudo = 'honorarios') AND bool_or(fk.conteudo = 'despesas')
  ),
  kit_estado AS (
    SELECT k.chave,
           CASE WHEN gs.contrato_id IS NOT NULL THEN fk.conteudo END AS conteudo,
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
      LEFT JOIN grupo_separado gs ON gs.contrato_id = fk.contrato_id
                                 AND gs.caso_id IS NOT DISTINCT FROM fk.caso_id
                                 AND gs.competencia = fk.competencia
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
           ke.conteudo,
           (gsk.contrato_id IS NOT NULL) AS grupo_separado,
           -- Documento vivo que impede separar/unir honorários e despesas:
           -- NFS-e não rejeitada, nota de débito gerada ou boleto vivo.
           CASE
             WHEN nf.status = 'gerado' AND COALESCE(nf.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
               THEN 'NFS-e ' || COALESCE(nf.nfse_numero, nf.numero::text, '') ||
                    CASE WHEN nf.focus_status = 'autorizado' THEN ' autorizada' ELSE ' emitida' END
             WHEN ndd.id IS NOT NULL THEN 'Nota de débito gerada'
             WHEN bv.chave IS NOT NULL OR ndbv.chave IS NOT NULL THEN 'Boleto registrado'
           END AS doc_vivo,
           ke.aj_grupo_id, ke.aj_grupo_nome, ke.aj_pagadores,
           nf.id AS nfse_id, nf.numero AS nfse_numero_interno, nf.numero_documento AS nfse_numero_documento,
           nf.nfse_numero, nf.status AS nfse_status,
           nf.focus_status AS nfse_focus_status, nf.arquivo_nome AS nfse_arquivo_nome,
           nf.arquivo_url AS nfse_arquivo_url, nf.valor_total AS nfse_valor_total,
           nf.created_at AS nfse_created_at,
           COALESCE(nf.compartilhada, false) AS nota_compartilhada,
           COALESCE(kns.nfses, '[]'::jsonb) AS nfses_json,
           COALESCE(knd.nds, '[]'::jsonb) AS nds_json,
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
                    WHEN (COALESCE(kns.n, 0) > 1 AND NOT kns.todas_pagas)
                      OR (COALESCE(knd.n, 0) > 1 AND NOT knd.todas_pagas) THEN
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
      LEFT JOIN kit_nds knd ON knd.chave = k.chave
      LEFT JOIN grupo_nfse gn ON gn.grupo = k.grupo
      LEFT JOIN kit_docs ndd ON ndd.chave = k.chave AND ndd.tipo_documento = 'nota_debito'
      LEFT JOIN grupo_separado gsk ON gsk.contrato_id = k.contrato_id
                                  AND gsk.caso_id IS NOT DISTINCT FROM k.caso_id
                                  AND gsk.competencia = k.competencia
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
      FROM (
        -- O par honorários/despesas decide junto o "Unir de novo" (antes do
        -- filtro de status, para o irmão filtrado também contar).
        SELECT x.*,
               max(x.doc_vivo) FILTER (WHERE x.conteudo IS NOT NULL) OVER (PARTITION BY x.grupo) AS doc_vivo_par,
               COALESCE(bool_or(x.finalizado_em IS NOT NULL) FILTER (WHERE x.conteudo IS NOT NULL)
                          OVER (PARTITION BY x.grupo), false) AS finalizado_par
          FROM kit_full x
      ) kf
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
             -- Filipe 28/10: 'honorarios' / 'despesas' quando o caso+competência
             -- fatura os dois em kits separados; null = juntos (o de sempre).
             'conteudo', f.conteudo,
             'pode_separar_despesas', (f.conteudo IS NULL AND NOT f.grupo_separado
                                       AND f.valor_servico > 0 AND f.valor_despesa > 0
                                       AND f.finalizado_em IS NULL AND f.doc_vivo IS NULL),
             'motivo_nao_separar', CASE
               WHEN f.conteudo IS NOT NULL OR f.grupo_separado OR f.valor_servico <= 0 OR f.valor_despesa <= 0 THEN NULL
               WHEN f.finalizado_em IS NOT NULL THEN 'Kit finalizado: reabra antes de separar as despesas.'
               WHEN f.doc_vivo IS NOT NULL THEN f.doc_vivo || ': cancele antes de separar as despesas.'
             END,
             'pode_unir_despesas', (f.conteudo IS NOT NULL AND f.doc_vivo_par IS NULL AND NOT f.finalizado_par),
             'motivo_nao_unir', CASE
               WHEN f.conteudo IS NULL THEN NULL
               WHEN f.finalizado_par THEN 'Kit finalizado: reabra antes de unir honorários e despesas.'
               WHEN f.doc_vivo_par IS NOT NULL THEN f.doc_vivo_par || ': cancele antes de unir honorários e despesas.'
             END,
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
               'notas_debito', f.nds_json,
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
             -- Filipe 16/10, item 6: vencimento no resumo do kit, sem abrir.
             -- O do boleto vivo; senão o da conta a receber viva; senão o que a
             -- NFS-e viva vai gerar; senão a regra do caso aplicada a hoje — a
             -- mesma conta de finance.vencimento_para_nota ao emitir.
             'vencimento', CASE
               WHEN f.boleto_id IS NOT NULL AND f.boleto_status NOT IN ('erro', 'cancelado', 'baixado')
                 THEN jsonb_build_object('data', f.boleto_vencimento, 'origem', 'boleto')
               WHEN f.lanc_id IS NOT NULL AND f.lanc_status <> 'cancelado'
                 THEN jsonb_build_object('data', f.lanc_vencimento, 'origem', 'conta_receber')
               WHEN f.nfse_id IS NOT NULL AND f.nfse_status = 'gerado'
                    AND COALESCE(f.nfse_focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
                 THEN jsonb_build_object('data', finance.vencimento_para_nota(f.nfse_id), 'origem', 'nota')
               ELSE jsonb_build_object('data', finance.vencimento_previsto(f.caso_id, f.contrato_id, current_date),
                                       'origem', 'regra')
             END,
             'pode_excluir', (f.motivo_bloqueio IS NULL),
             'motivo_bloqueio', f.motivo_bloqueio,
             -- Pendências do contrato (não do caso): null = não calculado.
             'pendencias', CASE WHEN v_competencia IS NULL THEN NULL ELSE jsonb_build_object(
               'fila', COALESCE(pd.fila, 0),
               'revisao', COALESCE(pd.revisao, 0),
               'aprovacao', COALESCE(pd.aprovacao, 0),
               'total', COALESCE(pd.fila + pd.revisao + pd.aprovacao, 0)) END
           ) AS caso
      FROM filtrado f
      LEFT JOIN itens_json ij ON ij.chave = f.chave
      LEFT JOIN pos p ON p.grupo = f.grupo AND f.kit_sequencia = f.ultima_sequencia
      LEFT JOIN itens_json pj ON pj.chave = f.grupo || '|pos' AND f.kit_sequencia = f.ultima_sequencia
      LEFT JOIN pend pd ON pd.contrato_id = f.contrato_id
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

CREATE OR REPLACE FUNCTION public.get_dados_envio_fatura(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_out jsonb;
  v_nota jsonb;
  v_nota_id uuid;
  v_item_ids uuid[];
  v_envia_ts boolean := false;
  v_anexos jsonb := '[]'::jsonb;
  v_seq int := COALESCE(p_kit_sequencia, 1);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  -- Base (cliente, destinatários, reply_to, permissão) vem da antiga.
  v_out := public.get_dados_envio_fatura(p_user_id, p_contrato_id);

  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;

  -- Itens do kit (para achar a NFS-e certa quando o caso tem mais de uma
  -- competência em aberto).
  IF p_caso_id IS NOT NULL OR v_competencia IS NOT NULL THEN
    -- Só os itens do kit (Filipe 16/10): sem os aprovados depois de
    -- finalizar e sem os do kit separado, a NFS-e achada é a deste kit.
    SELECT array_agg(a.item_id) INTO v_item_ids
      FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
     WHERE (p_caso_id IS NULL OR a.caso_id = p_caso_id)
       AND (v_competencia IS NULL OR a.competencia = v_competencia)
       AND NOT a.pendente
       AND (v_competencia IS NULL OR p_caso_id IS NULL OR a.kit_sequencia = v_seq);

    SELECT jsonb_build_object('id', bn.id, 'numero', bn.numero,
                              'arquivo_nome', bn.arquivo_nome, 'arquivo_url', bn.arquivo_url),
           bn.id
      INTO v_nota, v_nota_id
      FROM finance.billing_notes bn
     WHERE bn.tenant_id = v_tenant
       AND bn.contrato_id = p_contrato_id
       AND bn.tipo_documento = 'nota_fiscal_servico'
       AND bn.status <> 'cancelado'
       AND (p_caso_id IS NULL OR bn.caso_id = p_caso_id)
       AND (
         v_item_ids IS NULL
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
           WHERE x.value::uuid = ANY (v_item_ids))
       )
     ORDER BY bn.created_at DESC
     LIMIT 1;

    v_out := v_out || jsonb_build_object('nota', v_nota);
  ELSE
    v_nota_id := NULLIF(v_out->'nota'->>'id', '')::uuid;
  END IF;

  SELECT COALESCE(cs.enviar_relatorio_timesheet, false) INTO v_envia_ts
    FROM contracts.casos cs WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant;

  -- 1) NFS-e (PDF do Focus).
  IF v_nota_id IS NOT NULL THEN
    SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
             'tipo', 'nfse', 'nome', COALESCE(bn.arquivo_nome, 'nfse.pdf'), 'url', bn.arquivo_url)), v_anexos)
      INTO v_anexos
      FROM finance.billing_notes bn
     WHERE bn.id = v_nota_id AND NULLIF(bn.arquivo_url, '') IS NOT NULL;

    -- 2) Boleto: PDF registrado como boleto_itau ligado à nota (ou ao kit).
    SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
             'tipo', 'boleto', 'nome', COALESCE(b.arquivo_nome, 'boleto.pdf'), 'url', b.arquivo_url,
             'bucket', CASE WHEN b.arquivo_url ~* '^https?://' THEN NULL ELSE 'faturamento-documentos' END)), v_anexos)
      INTO v_anexos
      FROM (
        SELECT bn.arquivo_nome, bn.arquivo_url
          FROM finance.billing_notes bn
         WHERE bn.tenant_id = v_tenant
           AND bn.tipo_documento = 'boleto_itau'
           AND bn.status = 'gerado'
           AND NULLIF(bn.arquivo_url, '') IS NOT NULL
           AND (
             NULLIF(bn.metadata->>'nota_id', '')::uuid = v_nota_id
             OR NULLIF(bn.metadata->>'billing_note_id', '')::uuid = v_nota_id
             OR (bn.contrato_id = p_contrato_id
                 AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
                 AND (v_competencia IS NULL
                      OR NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
                 AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq)
           )
         ORDER BY bn.created_at DESC
         LIMIT 1
      ) b;
  END IF;

  -- 3) Relatório de timesheet (só se o caso pede) e 4) nota de débito.
  SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
           'tipo', d.tipo_documento, 'nome', COALESCE(d.arquivo_nome, d.tipo_documento || '.pdf'),
           'url', d.arquivo_url,
           'bucket', CASE WHEN d.arquivo_url ~* '^https?://' THEN NULL ELSE 'faturamento-documentos' END)
           ORDER BY d.tipo_documento DESC), v_anexos)
    INTO v_anexos
    FROM (
      -- Rateio das despesas (29/10): uma ND viva por pagador, todas vão.
      SELECT DISTINCT ON (bn.tipo_documento, COALESCE(bn.metadata->>'pagador_cliente_id', '')) bn.tipo_documento, bn.arquivo_nome, bn.arquivo_url
        FROM finance.billing_notes bn
       WHERE bn.tenant_id = v_tenant
         AND bn.contrato_id = p_contrato_id
         AND bn.status = 'gerado'
         AND NULLIF(bn.arquivo_url, '') IS NOT NULL
         AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
         AND (v_competencia IS NULL OR NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
         AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
         AND (
           bn.tipo_documento = 'nota_debito'
           -- Consolidado (Filipe 16/10): só a via principal vai no e-mail; as
           -- cópias dos outros kits do contrato não repetem o anexo.
           OR (bn.tipo_documento = 'relatorio_timesheet' AND v_envia_ts
               AND NOT (bn.metadata ? 'consolidado_de'))
         )
       ORDER BY bn.tipo_documento, COALESCE(bn.metadata->>'pagador_cliente_id', ''), bn.created_at DESC
    ) d;

  RETURN v_out || jsonb_build_object(
    'caso_id', p_caso_id,
    'competencia', v_competencia,
    'kit_sequencia', v_seq,
    'enviar_relatorio_timesheet', v_envia_ts,
    'anexos', v_anexos
  );
END $function$;
