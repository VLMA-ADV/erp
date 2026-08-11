-- Lotes de despesa (pedido Filipe 11/08).
--
-- O fluxo, nas palavras dele: o financeiro adianta um valor para uma pessoa
-- (uma saida da conta do Itau para a da Cora, as duas do VLMA), a pessoa vai
-- lancando despesas ate consumir o saldo, aperta "fechar lote", e a Jessika
-- valida e acerta a diferenca.
--
-- Decisoes que vieram das respostas dele:
--   * O saldo PODE ficar negativo. Quem pegou 200 e gastou 210 poe 10 do bolso
--     e tem 10 a receber. Nao bloqueia lancamento.
--   * A pessoa pode ter mais de um lote aberto ao mesmo tempo, entao a despesa
--     escolhe a qual lote pertence.
--   * Quem fecha e a propria pessoa; quem valida e o financeiro.
--   * Sobrou, ela devolve; faltou, ela recebe. Os dois viram lancamento em
--     contas a pagar/receber no momento da validacao.
--
-- Duas premissas ainda a confirmar com ele (as conservadoras, faceis de virar):
--   1. O adiantamento em si NAO vira lancamento. Transferencia entre contas do
--      proprio VLMA nao e despesa: se virasse lancamento, o mesmo dinheiro
--      contaria duas vezes — uma no adiantamento e outra nas despesas lancadas.
--      O lote guarda origem, destino e data para a conciliacao, e so o acerto
--      final entra no financeiro.
--   2. Despesa dentro de lote nasce NAO reembolsavel: o dinheiro ja foi
--      adiantado, e o acerto sai uma vez so, pelo saldo. Se continuasse
--      reembolsavel, a mesma despesa poderia ser paga duas vezes.

-- ── Tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operations.despesa_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- A pessoa que recebeu o adiantamento e vai lancar as despesas.
  colaborador_user_id uuid NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  descricao text NOT NULL,
  status text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'em_validacao', 'fechado', 'cancelado')),

  -- Rastro da transferencia, para a conciliacao no extrato. Nao gera
  -- lancamento: ver premissa 1 no topo.
  conta_bancaria_origem_id uuid REFERENCES finance.contas_bancarias(id),
  conta_bancaria_destino_id uuid REFERENCES finance.contas_bancarias(id),
  data_transferencia date,

  -- Lancamento do acerto (sobra a receber ou falta a pagar), criado na
  -- validacao. Fica nulo quando o lote fecha zerado.
  lancamento_acerto_id uuid REFERENCES finance.lancamentos(id),

  fechamento_solicitado_em timestamptz,
  fechamento_solicitado_por uuid,
  validado_em timestamptz,
  validado_por uuid,
  observacao_validacao text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS despesa_lotes_tenant_idx
  ON operations.despesa_lotes (tenant_id, status);
CREATE INDEX IF NOT EXISTS despesa_lotes_pessoa_idx
  ON operations.despesa_lotes (tenant_id, colaborador_user_id, status);

ALTER TABLE operations.despesas
  ADD COLUMN IF NOT EXISTS lote_id uuid REFERENCES operations.despesa_lotes(id);

CREATE INDEX IF NOT EXISTS despesas_lote_idx ON operations.despesas (lote_id);

-- ── Saldo ─────────────────────────────────────────────────────────────────
-- Positivo = ainda tem dinheiro do adiantamento. Negativo = a pessoa poe do
-- bolso e tem a receber. Cancelada nao conta: nao foi gasto.
CREATE OR REPLACE FUNCTION operations.saldo_lote_despesa(p_lote_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT l.valor - COALESCE((
    SELECT sum(d.valor) FROM operations.despesas d
    WHERE d.lote_id = l.id AND d.status <> 'cancelado'
  ), 0)
  FROM operations.despesa_lotes l
  WHERE l.id = p_lote_id;
$function$;

-- ── Criar ─────────────────────────────────────────────────────────────────
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
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Quem adianta dinheiro e o financeiro, entao vale a mesma permissao de
  -- lancar em contas a pagar. Nao inventamos papel novo.
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
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

  INSERT INTO operations.despesa_lotes (
    tenant_id, colaborador_user_id, valor, descricao, status,
    conta_bancaria_origem_id, conta_bancaria_destino_id, data_transferencia,
    created_by, updated_by
  ) VALUES (
    v_tenant_id, v_colaborador, v_valor, trim(p_payload->>'descricao'), 'aberto',
    NULLIF(p_payload->>'conta_bancaria_origem_id','')::uuid,
    NULLIF(p_payload->>'conta_bancaria_destino_id','')::uuid,
    NULLIF(p_payload->>'data_transferencia','')::date,
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── Listar ────────────────────────────────────────────────────────────────
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
      'finance.contas_pagar.*', 'finance.*', '*'
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

-- ── Fechar (a propria pessoa) ─────────────────────────────────────────────
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
     AND NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
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

-- ── Validar (financeiro) ──────────────────────────────────────────────────
-- Aprovar gera o acerto e fecha. Reabrir devolve o lote para a pessoa.
CREATE OR REPLACE FUNCTION public.validar_lote_despesa(
  p_user_id uuid, p_lote_id uuid, p_acao text DEFAULT 'aprovar', p_observacao text DEFAULT NULL
)
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

  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
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

-- ── Vinculo da despesa com o lote ─────────────────────────────────────────
-- Regra unica, usada na criacao e na edicao: o lote tem que ser da propria
-- pessoa e estar aberto. Depois de fechado o saldo ja virou lancamento, entao
-- mexer nas despesas mudaria um acerto que ja foi para o financeiro.
CREATE OR REPLACE FUNCTION operations.validar_lote_da_despesa(
  p_lote_id uuid, p_user_id uuid, p_tenant_id uuid
)
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

  IF v_lote.colaborador_user_id <> p_user_id THEN
    RAISE EXCEPTION 'Este lote é de outra pessoa';
  END IF;

  IF v_lote.status <> 'aberto' THEN
    RAISE EXCEPTION 'Lote não está aberto para novos lançamentos';
  END IF;
END;
$function$;
