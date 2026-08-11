-- O adiantamento do lote passa a ser uma saida de caixa.
--
-- Eu tinha decidido o contrario: transferencia entre contas do proprio VLMA nao
-- seria lancamento. O Filipe derrubou com um argumento melhor (11/08): "mesmo
-- reembolsavel no futuro, naquele momento presente o dinheiro teve saida" — e a
-- saude do caixa do dia que interessa ao financeiro.
--
-- Entao criar o lote lanca a saida, ja baixada, porque o dinheiro saiu de fato
-- na data informada. O caixa continua fechando no fim: adiantou 200, gastou 210,
-- o acerto lanca mais 10 de saida = 210. Adiantou 500, gastou 120, o acerto
-- lanca 380 de entrada = 120.
ALTER TABLE operations.despesa_lotes
  ADD COLUMN IF NOT EXISTS lancamento_adiantamento_id uuid REFERENCES finance.lancamentos(id);

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
