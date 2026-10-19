-- Aprovação automática de itens de faturamento cuja regra de cobrança é
-- PROJETO (pagamento único, sem parcelas) — resposta final do cliente, out/2026.
--
-- Escopo: só item de regra financeira 'projeto' sem parcelas. Fica de fora
-- projeto parcelado (regra 'projeto' com parcelas — é assim que o cadastro
-- grava o "projeto parcelado", e é o mesmo critério da fila), horas (mesmo em
-- caso de projeto), êxito, despesas, pró-labore e mensalidades.
--
-- Liga/desliga por tenant em core.system_settings, chave
-- 'faturamento.autoaprovar_projeto' (tipo boolean). Sem linha = DESLIGADO:
-- vai para produção desligada e só liga depois do fechamento de outubro.
-- Com a chave desligada nada muda: todo item continua nascendo em_revisao.
--
-- Item autoaprovado cujo valor for alterado depois (por qualquer caminho —
-- editar_valor_aprovado na Composição, SQL, etc.) volta para em_revisao com a
-- aprovação limpa; o valor editado vira o valor revisado para o revisor
-- conferir. Item que sai de 'aprovado' por devolução também perde a marca.

-- 1) A chave -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.autoaprovacao_projeto_ligada(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'core', 'public'
AS $function$
  SELECT COALESCE((
    SELECT lower(trim(COALESCE(s.valor, ''))) IN ('true', '1', 'sim', 'on')
    FROM core.system_settings s
    WHERE s.tenant_id = p_tenant_id
      AND s.chave = 'faturamento.autoaprovar_projeto'
    LIMIT 1
  ), false);
$function$;

COMMENT ON FUNCTION finance.autoaprovacao_projeto_ligada(uuid) IS
  'Liga/desliga da aprovação automática de itens de regra projeto. Lê core.system_settings (chave faturamento.autoaprovar_projeto). Sem linha = desligado.';

-- 2) A aprovação automática --------------------------------------------------
CREATE OR REPLACE FUNCTION finance.auto_aprovar_itens_projeto(p_user_id uuid, p_tenant_id uuid, p_batch_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'public'
AS $function$
DECLARE
  v_n integer := 0;
  v_batch_status varchar;
  v_autor constant text := 'Sistema (aprovação automática)';
BEGIN
  IF p_batch_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT finance.autoaprovacao_projeto_ligada(p_tenant_id) THEN
    RETURN 0;
  END IF;

  WITH alvo AS (
    SELECT bi.id
    FROM finance.billing_items bi
    JOIN contracts.casos cs
      ON cs.id = bi.caso_id
     AND cs.tenant_id = bi.tenant_id
    -- config da regra que gerou o item (mesma resolução de start_faturamento_flow:
    -- regra do array regras_financeiras pelo id; caso legado usa a config do caso)
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT x->'regra_cobranca_config'
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
          ) x
          WHERE COALESCE(NULLIF(x->>'id', ''), 'legacy-' || cs.id::text) = bi.snapshot->>'regra_id'
          LIMIT 1
        ),
        CASE WHEN bi.snapshot->>'regra_id' = 'legacy-' || cs.id::text
             THEN COALESCE(cs.regra_cobranca_config, '{}'::jsonb) END
      ) AS cfg
    ) rr
    WHERE bi.tenant_id = p_tenant_id
      AND bi.billing_batch_id = p_batch_id
      AND bi.status = 'em_revisao'
      AND bi.origem_tipo = 'regra_financeira'
      AND bi.grupo_id IS NULL
      AND bi.snapshot->>'regra_cobranca' = 'projeto'
      AND rr.cfg IS NOT NULL
      -- com parcelas é projeto parcelado: fica na revisão
      AND NOT (jsonb_typeof(rr.cfg->'parcelas') = 'array' AND jsonb_array_length(rr.cfg->'parcelas') > 0)
    FOR UPDATE OF bi
  ),
  aprovados AS (
    UPDATE finance.billing_items bi
    SET
      status = 'aprovado',
      horas_revisadas = COALESCE(bi.horas_informadas, 0),
      valor_revisado = bi.valor_informado,
      horas_aprovadas = COALESCE(bi.horas_informadas, 0),
      valor_aprovado = bi.valor_informado,
      data_revisao = now(),
      data_aprovacao = now(),
      snapshot = COALESCE(bi.snapshot, '{}'::jsonb) || jsonb_build_object(
        'auto_aprovado', true,
        'auto_aprovado_em', now(),
        'auto_aprovado_regra', 'projeto',
        'horas_revisadas', COALESCE(bi.horas_informadas, 0),
        'valor_revisado', bi.valor_informado,
        'horas_aprovadas', COALESCE(bi.horas_informadas, 0),
        'valor_aprovado', bi.valor_informado
      ),
      updated_at = now(),
      updated_by = p_user_id
    FROM alvo
    WHERE bi.id = alvo.id
    RETURNING bi.id, bi.tenant_id, COALESCE(bi.horas_informadas, 0) AS horas, bi.valor_informado AS valor
  ),
  hist AS (
    -- Uma linha por etapa, autor "Sistema". texto fica NULL de propósito: o
    -- texto do histórico vai para o relatório/nota (getLatestTexto na Revisão).
    INSERT INTO finance.revisao_fatura_itens_historico (
      billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
    )
    SELECT a.id, r.role, p_user_id, v_autor, a.horas, a.valor::numeric(12,2), NULL, a.tenant_id, now()
    FROM aprovados a
    CROSS JOIN (VALUES ('REVISOR'), ('APROVADOR')) r(role)
    RETURNING 1
  ),
  aud AS (
    INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
    SELECT a.tenant_id, a.id, 'auto_aprovacao', 'status', to_jsonb('em_revisao'::text), to_jsonb('aprovado'::text), p_user_id
    FROM aprovados a
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM aprovados;

  IF v_n > 0 THEN
    -- mesmo cálculo de set_revisao_fatura_status (o lote é solto logo depois
    -- pela edge, mas fica coerente enquanto existir)
    SELECT
      CASE
        WHEN counts.em_revisao > 0 THEN 'em_revisao'
        WHEN counts.em_aprovacao > 0 THEN 'em_aprovacao'
        WHEN counts.aprovado > 0 THEN 'aprovado'
        WHEN counts.faturado > 0 THEN 'faturado'
        ELSE 'cancelado'
      END
    INTO v_batch_status
    FROM (
      SELECT
        count(*) FILTER (WHERE bi.status = 'em_revisao') AS em_revisao,
        count(*) FILTER (WHERE bi.status = 'em_aprovacao') AS em_aprovacao,
        count(*) FILTER (WHERE bi.status = 'aprovado') AS aprovado,
        count(*) FILTER (WHERE bi.status = 'faturado') AS faturado
      FROM finance.billing_items bi
      WHERE bi.tenant_id = p_tenant_id
        AND bi.billing_batch_id = p_batch_id
        AND bi.status <> 'cancelado'
    ) counts;

    UPDATE finance.billing_batches b
    SET status = COALESCE(v_batch_status, b.status), updated_at = now(), updated_by = p_user_id
    WHERE b.id = p_batch_id
      AND b.tenant_id = p_tenant_id;
  END IF;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION finance.auto_aprovar_itens_projeto(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.autoaprovacao_projeto_ligada(uuid) FROM PUBLIC, anon, authenticated;

-- 3) Valor alterado depois de autoaprovado -> volta para a revisão ------------
CREATE OR REPLACE FUNCTION finance.trg_autoaprovado_volta_revisao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'public'
AS $function$
DECLARE
  v_ator uuid;
  v_valor numeric(14,2);
  v_horas numeric(12,2);
BEGIN
  IF COALESCE(OLD.snapshot->>'auto_aprovado', '') <> 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'aprovado' AND NEW.status = 'aprovado' AND (
       NEW.valor_aprovado IS DISTINCT FROM OLD.valor_aprovado
    OR NEW.valor_revisado IS DISTINCT FROM OLD.valor_revisado
    OR NEW.valor_informado IS DISTINCT FROM OLD.valor_informado
    OR NEW.horas_aprovadas IS DISTINCT FROM OLD.horas_aprovadas
  ) THEN
    v_ator := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by, OLD.created_by);
    v_valor := CASE
      WHEN NEW.valor_aprovado IS DISTINCT FROM OLD.valor_aprovado AND NEW.valor_aprovado IS NOT NULL THEN NEW.valor_aprovado
      WHEN NEW.valor_revisado IS DISTINCT FROM OLD.valor_revisado AND NEW.valor_revisado IS NOT NULL THEN NEW.valor_revisado
      ELSE NEW.valor_informado
    END;
    v_horas := COALESCE(NEW.horas_aprovadas, NEW.horas_revisadas, NEW.horas_informadas, 0);

    -- o valor editado vira a proposta do revisor; a aprovação é limpa
    NEW.status := 'em_revisao';
    NEW.valor_revisado := v_valor;
    NEW.horas_revisadas := v_horas;
    NEW.valor_aprovado := NULL;
    NEW.horas_aprovadas := NULL;
    NEW.data_aprovacao := NULL;
    NEW.responsavel_aprovacao_id := NULL;
    NEW.data_revisao := NULL;
    NEW.snapshot := (COALESCE(NEW.snapshot, '{}'::jsonb) - 'valor_aprovado' - 'horas_aprovadas')
      || jsonb_build_object(
        'auto_aprovado', false,
        'auto_aprovacao_desfeita_em', now(),
        'auto_aprovacao_desfeita_por', v_ator,
        'auto_aprovacao_valor_anterior', OLD.valor_aprovado,
        'valor_revisado', v_valor,
        'horas_revisadas', v_horas
      );

    INSERT INTO finance.revisao_fatura_itens_historico (
      billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
    ) VALUES (
      OLD.id, 'APROVADOR', v_ator, 'Sistema (valor alterado após aprovação automática — devolvido para revisão)',
      v_horas, v_valor::numeric(12,2), NULL, OLD.tenant_id, now()
    );

    INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
    VALUES (OLD.tenant_id, OLD.id, 'auto_aprovacao_desfeita', 'status', to_jsonb(OLD.status::text), to_jsonb('em_revisao'::text), v_ator);

    RETURN NEW;
  END IF;

  -- devolvido (retornar / excluir kit): volta a ser aprovação humana
  IF NEW.status IN ('em_revisao', 'em_aprovacao') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.snapshot := COALESCE(NEW.snapshot, '{}'::jsonb) || jsonb_build_object('auto_aprovado', false);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_autoaprovado_volta_revisao ON finance.billing_items;
CREATE TRIGGER trg_autoaprovado_volta_revisao
  BEFORE UPDATE ON finance.billing_items
  FOR EACH ROW
  WHEN (OLD.snapshot ? 'auto_aprovado')
  EXECUTE FUNCTION finance.trg_autoaprovado_volta_revisao();

-- 4) start_faturamento_flow: chama a aprovação automática no fim -------------
-- (versão de produção + o bloco "aprovação automática" antes do RETURN.
-- start_faturamento_despesas_fallback não muda: só cria despesas, que estão
-- fora da regra.)

CREATE OR REPLACE FUNCTION public.start_faturamento_flow(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data_inicio date;
  v_data_fim date;
  v_alvo_tipo varchar;
  v_alvo_id uuid;
  v_alvo_ids uuid[] := ARRAY[]::uuid[];
  v_search text;
  v_somente_regras boolean := false;
  v_batch_id uuid;
  v_batch_numero bigint;
  v_items_count int := 0;
  v_can_write boolean := false;
  -- 28/09: seleção de itens da fila (ver bloco alvo_chaves abaixo)
  v_sel_ts uuid[] := ARRAY[]::uuid[];
  v_sel_desp uuid[] := ARRAY[]::uuid[];
  v_sel_regra uuid[] := ARRAY[]::uuid[];
  v_filtra_itens boolean := false;
  v_msg_preco text;
  v_desp jsonb;
  v_desp_count int := 0;
  v_auto_count int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_write;
  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para iniciar fluxo de faturamento';
  END IF;
  v_data_inicio := NULLIF(p_payload->>'data_inicio', '')::date;
  v_data_fim := NULLIF(p_payload->>'data_fim', '')::date;
  v_alvo_tipo := COALESCE(NULLIF(p_payload->>'alvo_tipo', ''), 'itens');
  v_alvo_id := NULLIF(p_payload->>'alvo_id', '')::uuid;
  v_search := NULLIF(trim(COALESCE(p_payload->>'search', '')), '');
  v_somente_regras := COALESCE((p_payload->>'somente_regras')::boolean, false);
  IF jsonb_typeof(p_payload->'alvo_ids') = 'array' THEN
    SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_alvo_ids
    FROM jsonb_array_elements_text(p_payload->'alvo_ids') AS t(value)
    WHERE value IS NOT NULL
      AND value <> ''
      AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
  IF v_alvo_id IS NOT NULL THEN
    v_alvo_ids := array_append(v_alvo_ids, v_alvo_id);
  END IF;
  SELECT COALESCE(array_agg(DISTINCT entry), ARRAY[]::uuid[]) INTO v_alvo_ids
  FROM unnest(v_alvo_ids) AS entry;

  -- 28/09 (Filipe): "selecionar um a um e selecionar todos para liberar em
  -- massa". Com alvo_tipo='itens' a seleção chega por alvo_ids (origem_id da
  -- fila: timesheet.id, despesa.id ou o uuid da regra) e/ou alvo_chaves (os
  -- ids virtuais 'fila:<origem_tipo>:<origem_id>' que get_fila_por_competencia
  -- devolve). alvo_ids não diz o tipo, então vale para os três; alvo_chaves
  -- entra só no tipo que declara. Sem nenhum dos dois, 'itens' segue liberando
  -- o tenant inteiro (comportamento antigo).
  IF v_alvo_tipo = 'itens' THEN
    v_sel_ts := v_alvo_ids;
    v_sel_desp := v_alvo_ids;
    v_sel_regra := v_alvo_ids;
    IF jsonb_typeof(p_payload->'alvo_chaves') = 'array' THEN
      SELECT
        v_sel_ts || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'timesheet'), ARRAY[]::uuid[]),
        v_sel_desp || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'despesa'), ARRAY[]::uuid[]),
        v_sel_regra || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo NOT IN ('timesheet', 'despesa')), ARRAY[]::uuid[])
      INTO v_sel_ts, v_sel_desp, v_sel_regra
      FROM (
        SELECT split_part(value, ':', 2) AS tipo, split_part(value, ':', 3)::uuid AS origem
        FROM jsonb_array_elements_text(p_payload->'alvo_chaves') AS t(value)
        WHERE value ~* '^fila:[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) m;
    END IF;
    v_filtra_itens := COALESCE(array_length(v_sel_ts, 1), 0)
                    + COALESCE(array_length(v_sel_desp, 1), 0)
                    + COALESCE(array_length(v_sel_regra, 1), 0) > 0;
  END IF;

  -- Passo 7: barra hora sem preço antes de criar qualquer item.
  -- Com 'itens' os alvo_ids não são casos: a trava roda logo abaixo, só sobre
  -- as horas marcadas (uma hora sem preço de outro cargo não deve travar a
  -- que a pessoa escolheu).
  IF NOT v_somente_regras AND v_alvo_tipo <> 'itens' AND array_length(v_alvo_ids, 1) > 0 THEN
    PERFORM public.validar_precos_antes_de_liberar(v_tenant_id, v_alvo_ids);
  END IF;
  IF NOT v_somente_regras AND v_filtra_itens AND COALESCE(array_length(v_sel_ts, 1), 0) > 0 THEN
    -- Mesma regra de validar_precos_antes_de_liberar, restrita à seleção.
    SELECT string_agg(DISTINCT format('caso %s (%s)', cs.numero, COALESCE(cg.nome, 'sem cargo')), '; ')
      INTO v_msg_preco
    FROM operations.timesheets t
    JOIN contracts.casos cs ON cs.id = t.caso_id
    LEFT JOIN people.cargos cg ON cg.id = t.cargo_id
    WHERE t.tenant_id = v_tenant_id
      AND t.id = ANY(v_sel_ts)
      AND t.status = 'em_lancamento'
      AND COALESCE(t.horas, 0) > 0
      AND (
        COALESCE(NULLIF(cs.regra_cobranca, ''), '') IN ('hora', 'hora_com_cap')
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                 THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
          WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca', '') IN ('hora', 'hora_com_cap')
        )
      )
      AND COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) <= 0;
    IF v_msg_preco IS NOT NULL THEN
      RAISE EXCEPTION 'Não dá para liberar: sem valor/hora definido para %. Cadastre o valor na regra de cobrança do caso (ou o cargo na tabela de preço) antes de liberar.', v_msg_preco;
    END IF;
  END IF;
  IF v_data_inicio IS NULL OR v_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;
  IF v_data_inicio > v_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;
  IF v_alvo_tipo NOT IN ('cliente', 'contrato', 'caso', 'itens') THEN
    RAISE EXCEPTION 'Tipo de alvo inválido';
  END IF;
  IF v_alvo_tipo IN ('cliente', 'contrato', 'caso') AND COALESCE(array_length(v_alvo_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'alvo_id/alvo_ids é obrigatório para cliente/contrato/caso';
  END IF;
  INSERT INTO finance.billing_batches (
    tenant_id,
    status,
    alvo_tipo,
    alvo_id,
    data_inicio,
    data_fim,
    created_by,
    updated_by
  )
  VALUES (
    v_tenant_id,
    'em_revisao',
    v_alvo_tipo,
    -- com 'itens' o alvo_id seria um timesheet/despesa, não um cliente/contrato/caso
    CASE WHEN v_alvo_tipo <> 'itens' AND COALESCE(array_length(v_alvo_ids, 1), 0) = 1 THEN v_alvo_ids[1] ELSE NULL END,
    v_data_inicio,
    v_data_fim,
    p_user_id,
    p_user_id
  )
  RETURNING id, numero INTO v_batch_id, v_batch_numero;
  WITH eligible_timesheet AS (
    SELECT
      t.id AS origem_id,
      t.data_lancamento AS data_referencia,
      t.horas AS horas_informadas,
      -- Mesma regra da fila (get_itens_a_faturar): caso com cobranca mensal
      -- ja paga o trabalho, entao a hora vale zero. Se a fila e o gerador
      -- divergirem aqui, a pessoa confere R$ 0 e o item nasce com valor —
      -- foi o que aconteceu com a competencia da hora em 31/08.
      CASE
        WHEN COALESCE(NULLIF(rg.regra, ''), '') IN
             ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
         AND COALESCE((rg.cfg->>'cobra_excedente')::boolean, false) = false
        THEN 0
        ELSE COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
      END AS valor_hora,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      t.descricao AS ts_descricao,
      autor.nome AS ts_autor_nome,
      t.created_by AS ts_autor_user_id
    FROM operations.timesheets t
    JOIN contracts.contratos c
      ON c.id = t.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = c.cliente_id
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = t.caso_id
     AND cs.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(r0.x->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra,
        COALESCE(r0.x->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb) AS cfg
      FROM (
        SELECT CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
           AND jsonb_array_length(cs.regras_financeiras) > 0
          THEN cs.regras_financeiras->0
          ELSE '{}'::jsonb END AS x
      ) r0
    ) rg
    LEFT JOIN people.colaboradores autor
      ON autor.user_id = t.created_by
     AND autor.tenant_id = v_tenant_id
    WHERE t.tenant_id = v_tenant_id
      -- Hora segue a COMPETENCIA, nao a data em que foi digitada: trabalho de
      -- agosto e cobrado em setembro (Filipe, 31/08 e 01/09, sem excecao).
      -- Precisa ser igual ao filtro de get_itens_a_faturar — se a tela e o
      -- gerador lerem campos diferentes, a fatura sai diferente do que a
      -- pessoa conferiu. Foi o que aconteceu: tela mostrava 1.827 horas e o
      -- gerador pegava 1.
      AND COALESCE(t.periodo_faturamento, t.data_lancamento::date)
          BETWEEN v_data_inicio AND v_data_fim
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      -- 28/09: só as horas marcadas na fila
      AND (NOT v_filtra_itens OR t.id = ANY(v_sel_ts))
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = t.id
          AND bi.status <> 'cancelado'
      )
  ),
  eligible_rules_source AS (
    SELECT
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      rule_item,
      COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
      COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
      COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
      z.dia_inicio_faturamento,
      z.data_inicio_faturamento,
      COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status
    FROM contracts.casos cs
    JOIN contracts.contratos c ON c.id = cs.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT x AS rule_item
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
            THEN cs.regras_financeiras
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id', 'legacy-' || cs.id::text,
              'status', cs.status,
              'regra_cobranca', cs.regra_cobranca,
              'data_inicio_faturamento', cs.data_inicio_faturamento,
              'dia_inicio_faturamento', cs.dia_inicio_faturamento,
              'regra_cobranca_config', COALESCE(cs.regra_cobranca_config, '{}'::jsonb)
            )
          )
        END
      ) AS x
    ) r
    CROSS JOIN LATERAL public.z6_resolve_inicio_faturamento(
      r.rule_item,
      cs.data_inicio_faturamento,
      cs.dia_inicio_faturamento,
      c.created_at::date,
      v_data_inicio
    ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
    WHERE cs.tenant_id = v_tenant_id
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
  ),
  eligible_rules_enriched AS (
    SELECT
      ers.*,
      (
        SELECT sm.valor
        FROM config.salario_minimo sm
        WHERE sm.tenant_id = v_tenant_id
          AND sm.vigencia_desde <= GREATEST(ers.data_inicio_faturamento, v_data_inicio)::date
        ORDER BY sm.vigencia_desde DESC
        LIMIT 1
      ) AS valor_sm_ref
    FROM eligible_rules_source ers
  ),
  eligible_rules_calc AS (
    SELECT
      ers.*,
      finance.rule_origin_uuid(ers.caso_id, ers.rule_id) AS origem_id,
      CASE
        WHEN ers.regra_cobranca IN ('mensal', 'mensalidade_processo') THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                -- trava do dia do mes removida — ver comentario em get_itens_a_faturar
              )
            )
        WHEN ers.regra_cobranca = 'mensalidade_carteira' THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal_carteira', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                -- trava do dia do mes removida — ver comentario em get_itens_a_faturar
              )
            )
        WHEN ers.regra_cobranca IN ('projeto', 'pro_labore') THEN
          CASE
            WHEN jsonb_typeof(ers.cfg->'parcelas') = 'array' AND jsonb_array_length(ers.cfg->'parcelas') > 0 THEN
              COALESCE((
                SELECT SUM(COALESCE(NULLIF(p->>'valor', '')::numeric, 0))
                FROM jsonb_array_elements(ers.cfg->'parcelas') p
                WHERE NULLIF(p->>'data_pagamento', '')::date BETWEEN v_data_inicio AND v_data_fim
              ), 0)
            WHEN ers.data_inicio_faturamento BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(NULLIF(ers.cfg->>'valor_projeto', '')::numeric, 0)
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'exito' THEN
          CASE
            WHEN NULLIF(ers.cfg->>'data_pagamento_exito', '')::date BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(
                NULLIF(ers.cfg->>'valor_exito_calculado', '')::numeric,
                (COALESCE(NULLIF(ers.cfg->>'valor_acao', '')::numeric, 0)
                  * COALESCE(NULLIF(ers.cfg->>'percentual_exito', '')::numeric, 0) / 100.0)
              )
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'salario_minimo' THEN
          COALESCE(NULLIF(ers.rule_item->>'quantidade_sm', '')::numeric, NULLIF(ers.cfg->>'quantidade_sm', '')::numeric, 0)
          * COALESCE(ers.valor_sm_ref, 0)
        ELSE 0
      END::numeric(14,2) AS valor_regra
    FROM eligible_rules_enriched ers
    WHERE ers.regra_cobranca IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'projeto', 'pro_labore', 'exito', 'salario_minimo')
      AND ers.rule_status = 'ativo'
  ),
  inserted_timesheet AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      e.cliente_id,
      e.contrato_id,
      e.caso_id,
      'timesheet',
      e.origem_id,
      e.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      (COALESCE(e.horas_informadas, 0) * COALESCE(e.valor_hora, 0))::numeric(14,2),
      e.horas_informadas,
      jsonb_build_object(
        'cliente_id', e.cliente_id,
        'cliente_nome', e.cliente_nome,
        'contrato_id', e.contrato_id,
        'contrato_numero', e.contrato_numero,
        'contrato_nome', e.nome_contrato,
        'caso_id', e.caso_id,
        'caso_numero', e.caso_numero,
        'caso_nome', e.caso_nome,
        'valor_hora', COALESCE(e.valor_hora, 0),
        'origem', 'timesheet',
        -- autor do lançamento: exibição estável mesmo se o timesheet sumir depois
        'timesheet_profissional', COALESCE(e.ts_autor_nome, ''),
        'timesheet_autor_user_id', e.ts_autor_user_id,
        'timesheet_data_lancamento', e.data_referencia::text,
        'timesheet_descricao', COALESCE(e.ts_descricao, ''),
        'timesheet_horas', COALESCE(e.horas_informadas, 0)
      ),
      p_user_id,
      p_user_id
    FROM eligible_timesheet e
    -- 'Gerar faturamento do mês' não arrasta horas: elas entram quando o
    -- financeiro envia (por caso/contrato) — call de 08/07.
    WHERE NOT v_somente_regras
    RETURNING id
  ),
  inserted_regras AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      r.cliente_id,
      r.contrato_id,
      r.caso_id,
      'regra_financeira',
      r.origem_id,
      GREATEST(r.data_inicio_faturamento, v_data_inicio),
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      COALESCE(r.valor_regra, 0)::numeric(14,2),
      0,
      jsonb_build_object(
        'cliente_id', r.cliente_id,
        'cliente_nome', r.cliente_nome,
        'contrato_id', r.contrato_id,
        'contrato_numero', r.contrato_numero,
        'contrato_nome', r.nome_contrato,
        'caso_id', r.caso_id,
        'caso_numero', r.caso_numero,
        'caso_nome', r.caso_nome,
        'regra_id', r.rule_id,
        'regra_cobranca', r.regra_cobranca,
        'origem', 'regra_financeira',
        'regra', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN 'salario_minimo' ELSE NULL END,
        'quantidade_sm', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN COALESCE(NULLIF(r.rule_item->>'quantidade_sm', '')::numeric, NULLIF(r.cfg->>'quantidade_sm', '')::numeric) ELSE NULL END,
        'valor_sm_no_lancamento', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN r.valor_sm_ref ELSE NULL END
      ),
      p_user_id,
      p_user_id
    FROM eligible_rules_calc r
    WHERE r.valor_regra > 0
      -- 28/09: só as regras marcadas na fila. A fila (get_itens_a_faturar)
      -- mostra UMA linha por mês/parcela/êxito, com origem_id derivado
      -- (rule_origin_uuid(caso, rule_id || ':mensal:YYYYMM' | ':parcela:N' |
      -- ':projeto_unico' | ':exito')); o gerador cria UM item por regra no
      -- período, com origem_id = rule_origin_uuid(caso, rule_id). Então aceita
      -- o id do gerador e qualquer id de linha da fila dessa regra no período.
      -- Como a fila é sempre mensal, marcar a linha = gerar a regra do mês.
      AND (
        NOT v_filtra_itens
        OR r.origem_id = ANY(v_sel_regra)
        OR EXISTS (
          SELECT 1
          FROM (
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':mensal:' || to_char(gs.ref_mes, 'YYYYMM')) AS fila_id
            FROM generate_series(
              date_trunc('month', v_data_inicio)::date,
              date_trunc('month', v_data_fim)::date,
              interval '1 month'
            ) AS gs(ref_mes)
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':parcela:' || p.ord::text)
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(r.cfg->'parcelas') = 'array' THEN r.cfg->'parcelas' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS p(item, ord)
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':projeto_unico')
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':exito')
          ) f
          WHERE f.fila_id = ANY(v_sel_regra)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.origem_id = r.origem_id
          AND bi.periodo_inicio = v_data_inicio
          AND bi.periodo_fim = v_data_fim
          AND bi.status <> 'cancelado'
      )
    RETURNING id
  )
  SELECT
    COALESCE((SELECT count(*) FROM inserted_timesheet), 0)
    + COALESCE((SELECt count(*) FROM inserted_regras), 0)
  INTO v_items_count;

  -- 28/09: despesas marcadas na fila. A edge só chama o fallback de despesas
  -- quando esta função não cria nada; numa seleção mista (horas + despesas)
  -- as despesas ficariam para trás. Então o fallback roda aqui, com o mesmo
  -- payload (ele filtra por alvo_ids/alvo_chaves), e o lote extra é solto na
  -- hora — igual ao que a edge faz com o lote principal.
  IF v_filtra_itens AND COALESCE(array_length(v_sel_desp, 1), 0) > 0 THEN
    BEGIN
      v_desp := public.start_faturamento_despesas_fallback(p_user_id, p_payload);
      v_desp_count := COALESCE((v_desp->>'itens_criados')::int, 0);
      IF NULLIF(v_desp->>'batch_id', '') IS NOT NULL THEN
        PERFORM public.detach_faturamento_batch(p_user_id, (v_desp->>'batch_id')::uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE 'Nenhum item elegível%' THEN
        v_desp_count := 0;
      ELSE
        RAISE;
      END IF;
    END;
  END IF;
  IF v_items_count = 0 AND v_desp_count > 0 THEN
    -- só despesas: o lote de horas/regras nasceu vazio, some
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    v_batch_id := NULL;
    v_batch_numero := NULL;
  END IF;
  v_items_count := v_items_count + v_desp_count;

  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    -- Gerar do mês é idempotente: se as regras do mês já foram geradas,
    -- responde ok (0 novos) em vez de erro — evita o "não consigo forçar".
    IF v_somente_regras THEN
      RETURN jsonb_build_object(
        'batch_id', NULL,
        'batch_numero', NULL,
        'itens_criados', 0,
        'mensagem', 'Todas as regras do período já estavam geradas — nenhum item novo.'
      );
    END IF;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;
  UPDATE operations.timesheets t
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND v_batch_id IS NOT NULL
    AND t.id IN (
      SELECT bi.origem_id
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.billing_batch_id = v_batch_id
        AND bi.origem_tipo = 'timesheet'
    )
    AND t.status = 'em_lancamento';

  -- 18/10: aprovação automática dos itens de regra projeto (sem parcelas).
  -- Só age com a chave do tenant ligada (finance.autoaprovacao_projeto_ligada,
  -- core.system_settings 'faturamento.autoaprovar_projeto'); desligada devolve
  -- 0 e o lote sai exatamente como antes — tudo em_revisao.
  IF v_batch_id IS NOT NULL THEN
    v_auto_count := finance.auto_aprovar_itens_projeto(p_user_id, v_tenant_id, v_batch_id);
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  ) || CASE WHEN v_auto_count > 0
            THEN jsonb_build_object('itens_autoaprovados', v_auto_count)
            ELSE '{}'::jsonb END;
END;
$function$;
