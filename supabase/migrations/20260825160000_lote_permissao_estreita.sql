-- =====================================================================
-- Permissao estreita para gerir lote de despesas
--
-- Filipe, 25/08: "Vale para o lote de qualquer pessoa, pode criar, fechar,
-- editar. Deixe isso o menos desamarrado possivel!" — sobre a Thais.
--
-- O problema: os 8 portoes do lote checavam 'finance.contas_pagar.write', que
-- e a chave do modulo financeiro INTEIRO. Dar ela a Thais destravaria o lote,
-- mas de brinde tambem: criar lancamento avulso, dar baixa em conta e mexer em
-- saldo de conta bancaria. Nao e o que se pediu.
--
-- A saida e uma chave propria — 'operations.despesa_lotes.manage' — que fala
-- so de lote, e um helper que aceita as duas. Quem ja tinha contas_pagar.write
-- continua exatamente como estava; quem recebe a chave nova ganha o lote
-- completo (criar, editar, fechar, cancelar, validar, lancar em lote de
-- terceiro, ver os lotes de todos) e nada alem disso.
--
-- Grant NOMINAL para a Thais, como foi feito com 'operations.despesas.manage'
-- em 17/08 — nao mudanca de cargo, que afetaria os outros 30 advogados.
-- =====================================================================

CREATE OR REPLACE FUNCTION finance._pode_gerir_lote(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'core'
AS $helper$
  SELECT finance._cp_pode(p_user_id, 'finance.contas_pagar.write')
      OR finance._cp_pode(p_user_id, 'operations.despesa_lotes.manage');
$helper$;


-- ── cancelar_lote_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_lote_despesa(p_user_id uuid, p_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
  v_qtd_despesas int;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar lote de despesas';
  END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_lote.status <> 'aberto' THEN
    RAISE EXCEPTION 'Só é possível cancelar um lote aberto';
  END IF;

  SELECT count(*) INTO v_qtd_despesas
  FROM operations.despesas d WHERE d.lote_id = p_lote_id AND d.status <> 'cancelado';
  IF v_qtd_despesas > 0 THEN
    RAISE EXCEPTION 'Lote tem % despesa(s) lançada(s) — feche e valide em vez de cancelar', v_qtd_despesas;
  END IF;

  IF v_lote.lancamento_adiantamento_id IS NOT NULL THEN
    UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
    WHERE id = v_lote.lancamento_adiantamento_id AND tenant_id = v_tenant_id;
  END IF;

  UPDATE operations.despesa_lotes
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE id = p_lote_id;

  RETURN jsonb_build_object('id', p_lote_id, 'status', 'cancelado');
END;
$function$;

-- ── criar_lote_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_lote_despesa(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_colaborador uuid;
  v_valor numeric(14,2);
  v_id uuid;
  v_pessoa text;
  v_data date;
  v_origem uuid;
  v_destino uuid;
  v_lancamento uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para criar lote de despesas';
  END IF;

  v_colaborador := NULLIF(p_payload->>'colaborador_user_id', '')::uuid;
  IF v_colaborador IS NULL THEN RAISE EXCEPTION 'Informe a pessoa do lote'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.tenant_users tu
    WHERE tu.user_id = v_colaborador AND tu.tenant_id = v_tenant_id AND tu.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Pessoa não encontrada neste escritório';
  END IF;

  v_valor := NULLIF(replace(COALESCE(p_payload->>'valor',''), ',', '.'), '')::numeric;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'Valor do lote é obrigatório e deve ser maior que zero';
  END IF;

  IF COALESCE(trim(p_payload->>'descricao'), '') = '' THEN
    RAISE EXCEPTION 'Descrição do lote é obrigatória';
  END IF;

  v_data := COALESCE(NULLIF(p_payload->>'data_transferencia','')::date, current_date);
  v_origem := NULLIF(p_payload->>'conta_bancaria_origem_id','')::uuid;
  v_destino := NULLIF(p_payload->>'conta_bancaria_destino_id','')::uuid;

  SELECT col.nome INTO v_pessoa FROM people.colaboradores col
  WHERE col.user_id = v_colaborador AND col.tenant_id = v_tenant_id LIMIT 1;
  v_pessoa := COALESCE(NULLIF(trim(COALESCE(v_pessoa,'')),''), 'colaborador');

  INSERT INTO operations.despesa_lotes (
    tenant_id, colaborador_user_id, valor, descricao, status,
    conta_bancaria_origem_id, conta_bancaria_destino_id, data_transferencia,
    created_by, updated_by
  ) VALUES (
    v_tenant_id, v_colaborador, v_valor, trim(p_payload->>'descricao'), 'aberto',
    v_origem, v_destino, v_data, p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  -- Saida ja baixada: o dinheiro saiu na data informada, nao e uma conta a
  -- vencer. origem_ref_id amarra no lote para dar para conferir depois.
  INSERT INTO finance.lancamentos (
    tenant_id, natureza, tipo, status, descricao, valor, vencimento,
    fornecedor_nome, conta_bancaria_id, baixa_data, baixa_valor, baixa_conta_id,
    origem, origem_ref_id, created_by
  ) VALUES (
    v_tenant_id, 'pagar', 'transferencia', 'pago',
    'Adiantamento de despesas — ' || v_pessoa || ' (' || trim(p_payload->>'descricao') || ')',
    v_valor, v_data, v_pessoa, v_origem, v_data, v_valor, v_origem,
    'manual', v_id, p_user_id
  ) RETURNING id INTO v_lancamento;

  UPDATE operations.despesa_lotes
  SET lancamento_adiantamento_id = v_lancamento
  WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'lancamento_adiantamento_id', v_lancamento);
END;
$function$;

-- ── editar_lote_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.editar_lote_despesa(p_user_id uuid, p_lote_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
  v_valor numeric(14,2);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Editar lote é do financeiro, não do dono: o dono lança despesa dentro do
  -- lote, quem mexe no adiantamento é quem transferiu o dinheiro.
  IF NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar lote';
  END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_lote.status IN ('fechado', 'cancelado') THEN
    RAISE EXCEPTION 'Lote % não pode mais ser editado', v_lote.status;
  END IF;

  v_valor := COALESCE(NULLIF(p_payload->>'valor', '')::numeric, v_lote.valor);
  IF v_valor <= 0 THEN RAISE EXCEPTION 'Valor do adiantamento deve ser maior que zero'; END IF;

  UPDATE operations.despesa_lotes SET
    valor = v_valor,
    descricao = COALESCE(NULLIF(p_payload->>'descricao', ''), descricao),
    conta_bancaria_origem_id = COALESCE(NULLIF(p_payload->>'conta_bancaria_origem_id', '')::uuid, conta_bancaria_origem_id),
    conta_bancaria_destino_id = COALESCE(NULLIF(p_payload->>'conta_bancaria_destino_id', '')::uuid, conta_bancaria_destino_id),
    data_transferencia = COALESCE(NULLIF(p_payload->>'data_transferencia', '')::date, data_transferencia),
    updated_at = now(),
    updated_by = p_user_id
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_lote_id, 'valor', v_valor);
END;
$function$;

-- ── fechar_lote_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fechar_lote_despesa(p_user_id uuid, p_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  -- Fecha quem e dono do lote. O financeiro tambem pode, para destravar quem
  -- saiu do escritorio ou esqueceu.
  IF v_lote.colaborador_user_id <> p_user_id
     AND NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Só a pessoa do lote pode fechá-lo';
  END IF;

  IF v_lote.status <> 'aberto' THEN
    RAISE EXCEPTION 'Lote não está aberto';
  END IF;

  UPDATE operations.despesa_lotes
  SET status = 'em_validacao',
      fechamento_solicitado_em = now(),
      fechamento_solicitado_por = p_user_id,
      updated_at = now(),
      updated_by = p_user_id
  WHERE id = p_lote_id;

  RETURN jsonb_build_object('id', p_lote_id, 'status', 'em_validacao',
                            'saldo', operations.saldo_lote_despesa(p_lote_id));
END;
$function$;

-- ── get_lotes_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_lotes_despesa(p_user_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_ve_todos boolean := false;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Quem cuida do financeiro ve os lotes de todo mundo; as demais pessoas veem
  -- apenas os proprios, que e o que elas precisam para lancar.
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.contas_pagar.read', 'finance.contas_pagar.write',
      'finance.contas_pagar.*', 'finance.*', '*',
      'operations.despesa_lotes.manage'
    )
  ) INTO v_ve_todos;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'colaborador_user_id', l.colaborador_user_id,
        'colaborador_nome', col.nome,
        'valor', l.valor,
        'descricao', l.descricao,
        'status', l.status,
        'saldo', operations.saldo_lote_despesa(l.id),
        'total_gasto', l.valor - operations.saldo_lote_despesa(l.id),
        'qtd_despesas', (
          SELECT count(*) FROM operations.despesas d
          WHERE d.lote_id = l.id AND d.status <> 'cancelado'
        ),
        'conta_bancaria_origem_id', l.conta_bancaria_origem_id,
        'conta_origem_descricao', bo.descricao,
        'conta_bancaria_destino_id', l.conta_bancaria_destino_id,
        'conta_destino_descricao', bd.descricao,
        'data_transferencia', l.data_transferencia,
        'lancamento_acerto_id', l.lancamento_acerto_id,
        'fechamento_solicitado_em', l.fechamento_solicitado_em,
        'validado_em', l.validado_em,
        'observacao_validacao', l.observacao_validacao,
        'created_at', l.created_at
      )
      ORDER BY l.created_at DESC
    )
    FROM operations.despesa_lotes l
    LEFT JOIN people.colaboradores col
      ON col.user_id = l.colaborador_user_id AND col.tenant_id = l.tenant_id
    LEFT JOIN finance.contas_bancarias bo ON bo.id = l.conta_bancaria_origem_id
    LEFT JOIN finance.contas_bancarias bd ON bd.id = l.conta_bancaria_destino_id
    WHERE l.tenant_id = v_tenant_id
      AND (v_ve_todos OR l.colaborador_user_id = p_user_id)
      AND (NULLIF(p_filtros->>'status','') IS NULL OR l.status = p_filtros->>'status')
      AND (NULLIF(p_filtros->>'colaborador_user_id','') IS NULL
           OR l.colaborador_user_id = (p_filtros->>'colaborador_user_id')::uuid)
  ), '[]'::jsonb);
END;
$function$;

-- ── get_pessoas_para_lote ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pessoas_para_lote(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people', 'finance'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', tu.user_id, 'nome', col.nome)
                     ORDER BY col.nome)
    FROM core.tenant_users tu
    JOIN people.colaboradores col
      ON col.user_id = tu.user_id AND col.tenant_id = tu.tenant_id
    WHERE tu.tenant_id = v_tenant_id
      AND tu.status = 'ativo'
      AND COALESCE(col.ativo, true)
  ), '[]'::jsonb);
END;
$function$;

-- ── validar_lote_da_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION operations.validar_lote_da_despesa(p_lote_id uuid, p_user_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_lote operations.despesa_lotes%ROWTYPE;
BEGIN
  IF p_lote_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  -- Dono do lote sempre pode. O financeiro também, para lançar a nota que a
  -- pessoa entregou no papel sem ter de pedir que ela mesma digite.
  IF v_lote.colaborador_user_id <> p_user_id
     AND NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Este lote é de outra pessoa';
  END IF;

  IF v_lote.status <> 'aberto' THEN
    RAISE EXCEPTION 'Lote não está aberto para novos lançamentos';
  END IF;
END;
$function$;

-- ── validar_lote_despesa ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validar_lote_despesa(p_user_id uuid, p_lote_id uuid, p_acao text DEFAULT 'aprovar'::text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
  v_saldo numeric(14,2);
  v_pessoa text;
  v_lancamento uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._pode_gerir_lote(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para validar lote de despesas';
  END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_lote.status <> 'em_validacao' THEN
    RAISE EXCEPTION 'Lote não está aguardando validação';
  END IF;

  IF p_acao = 'reabrir' THEN
    UPDATE operations.despesa_lotes
    SET status = 'aberto',
        fechamento_solicitado_em = NULL,
        fechamento_solicitado_por = NULL,
        observacao_validacao = NULLIF(trim(COALESCE(p_observacao, '')), ''),
        updated_at = now(),
        updated_by = p_user_id
    WHERE id = p_lote_id;
    RETURN jsonb_build_object('id', p_lote_id, 'status', 'aberto');
  END IF;

  IF p_acao <> 'aprovar' THEN
    RAISE EXCEPTION 'Ação inválida: use aprovar ou reabrir';
  END IF;

  v_saldo := operations.saldo_lote_despesa(p_lote_id);

  SELECT col.nome INTO v_pessoa FROM people.colaboradores col
  WHERE col.user_id = v_lote.colaborador_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;
  v_pessoa := COALESCE(NULLIF(trim(COALESCE(v_pessoa, '')), ''), 'colaborador');

  -- Sobrou dinheiro do adiantamento: a pessoa devolve, entao e uma entrada.
  -- Faltou: ela poe do bolso e o VLMA reembolsa, entao e uma saida. Zerado nao
  -- gera lancamento nenhum — nao ha o que acertar.
  IF v_saldo > 0 THEN
    INSERT INTO finance.lancamentos (
      tenant_id, natureza, status, descricao, valor, vencimento,
      fornecedor_nome, origem, origem_ref_id, created_by
    ) VALUES (
      v_tenant_id, 'receber', 'pendente',
      'Devolução de saldo do lote de despesas — ' || v_pessoa || ' (' || v_lote.descricao || ')',
      v_saldo, current_date, v_pessoa, 'reembolso', p_lote_id, p_user_id
    ) RETURNING id INTO v_lancamento;
  ELSIF v_saldo < 0 THEN
    INSERT INTO finance.lancamentos (
      tenant_id, natureza, status, descricao, valor, vencimento,
      fornecedor_nome, origem, origem_ref_id, created_by
    ) VALUES (
      v_tenant_id, 'pagar', 'pendente',
      'Reembolso do lote de despesas — ' || v_pessoa || ' (' || v_lote.descricao || ')',
      abs(v_saldo), current_date, v_pessoa, 'reembolso', p_lote_id, p_user_id
    ) RETURNING id INTO v_lancamento;
  END IF;

  UPDATE operations.despesa_lotes
  SET status = 'fechado',
      validado_em = now(),
      validado_por = p_user_id,
      observacao_validacao = NULLIF(trim(COALESCE(p_observacao, '')), ''),
      lancamento_acerto_id = v_lancamento,
      updated_at = now(),
      updated_by = p_user_id
  WHERE id = p_lote_id;

  RETURN jsonb_build_object(
    'id', p_lote_id, 'status', 'fechado', 'saldo', v_saldo,
    'lancamento_acerto_id', v_lancamento
  );
END;
$function$;


-- ── a chave e o grant nominal ────────────────────────────────────────
INSERT INTO core.permissions (tenant_id, chave, descricao)
SELECT DISTINCT t.tenant_id, 'operations.despesa_lotes.manage',
       'Criar, editar, fechar e lancar em lote de adiantamento de qualquer pessoa'
FROM core.tenant_users t
WHERE t.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND NOT EXISTS (
    SELECT 1 FROM core.permissions p
    WHERE p.tenant_id = t.tenant_id AND p.chave = 'operations.despesa_lotes.manage'
  );

INSERT INTO core.user_permissions (tenant_id, user_id, permission_id)
SELECT c.tenant_id, c.user_id, p.id
FROM people.colaboradores c
JOIN auth.users u ON u.id = c.user_id
JOIN core.permissions p
  ON p.tenant_id = c.tenant_id AND p.chave = 'operations.despesa_lotes.manage'
WHERE c.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND c.user_id IS NOT NULL
  AND u.email = 'thais.rolim@vlma.com.br'
  AND NOT EXISTS (
    SELECT 1 FROM core.user_permissions up
    WHERE up.tenant_id = c.tenant_id AND up.user_id = c.user_id AND up.permission_id = p.id
  );
