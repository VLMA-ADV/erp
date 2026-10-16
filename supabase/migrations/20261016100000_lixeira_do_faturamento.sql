-- =====================================================================
-- Lixeira do faturamento (etapa 1, aprovada pelo cliente em 10/2026)
--
-- Escopo: SÓ os lançamentos de hora excluídos da fila de faturar
-- (operations.timesheets.excluido_faturamento, gravado por
-- excluir_timesheets_do_faturamento — 20260812100000). Ficam de fora:
--   * itens ignorados (billing_items.status = 'ignorado');
--   * itens cancelados por excluir_billing_items — esses já voltam sozinhos
--     para a fila, não há o que restaurar.
--
-- Retenção de 12 meses: o lançamento só aparece na lixeira, e só pode ser
-- restaurado, enquanto excluido_faturamento_em >= now() - 12 meses. Depois
-- disso ele só SOME da lixeira — nada é apagado, não existe job de expurgo.
-- O timesheet segue existindo (horas da pessoa, relatórios) e continua
-- marcado como excluído.
--
-- Restaurar exige a permissão nova finance.faturamento.lixeira.restore,
-- concedida NOMINALMENTE (core.user_permissions, ou por role). Não dá para
-- ler pela get_user_permissions: ela devolve TODAS as chaves para categoria
-- 'socio' e 'administrativo', então uma chave nova valeria automaticamente
-- para todo administrativo (hoje Fabiano Follador e Mylena/recepção) — o
-- mesmo motivo de finance.escopo_faturamento ler ver_todos nominalmente
-- (20260903211000). Por isso os sócios recebem a concessão explícita abaixo.
--
-- Restaurar devolve o lançamento à fila NO MÊS CORRENTE. A fila
-- (get_itens_a_faturar / get_fila_por_competencia) põe o timesheet na
-- competência de COALESCE(periodo_faturamento, data_lancamento); então
-- restaurar grava periodo_faturamento = 1º dia do mês corrente — a mesma
-- coluna e o mesmo efeito de postergar_timesheet (20260812120000).
-- Exceção: se a competência original ainda é futura (hora lançada neste mês
-- já nasce com competência no mês seguinte — _periodo_faturamento_padrao),
-- ela é mantida; restaurar não adianta cobrança.
--
-- Fecha também o "desfazer" antigo: excluir_timesheets_do_faturamento com
-- p_excluir = false restaurava para qualquer um com finance.faturamento.write.
-- Agora delega para restaurar_timesheets_lixeira (mesma permissão, mesma
-- janela de 12 meses, mesmo mês corrente). Nenhuma tela chamava com false.
--
-- Objetos:
--   1. permissão finance.faturamento.lixeira.restore + concessões por e-mail
--   2. finance._tem_permissao_nominal(uuid, text)
--   3. public.get_lixeira_faturamento(p_user_id, p_busca, p_mes)
--   4. public.restaurar_timesheets_lixeira(p_user_id, p_ids)
--   5. public.excluir_timesheets_do_faturamento — CREATE OR REPLACE, mesma
--      assinatura, a partir da definição de produção de 16/10/2026
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissão + concessão nominal (padrão de 20260903210000)
-- ---------------------------------------------------------------------
INSERT INTO core.permissions (tenant_id, chave, descricao)
SELECT DISTINCT t.tenant_id, 'finance.faturamento.lixeira.restore',
       'Restaurar lancamentos da lixeira do faturamento (devolve a fila no mes corrente)'
FROM core.tenant_users t
WHERE t.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND NOT EXISTS (SELECT 1 FROM core.permissions p
                   WHERE p.tenant_id = t.tenant_id AND p.chave = 'finance.faturamento.lixeira.restore');

-- Sócios ativos (people.colaboradores.categoria = 'socio', ativo, cargo
-- "Sócio"; contas de teste/dev de fora) + os nomes pedidos pelo cliente:
-- Bruna Fedatto, Cines (Cinesvaldo Cavalieri), Larissa Quadros e Jessika
-- Lira. Filipe Küster já é sócio. Levantado em produção em 16/10/2026.
INSERT INTO core.user_permissions (tenant_id, user_id, permission_id)
SELECT c.tenant_id, c.user_id, p.id
FROM people.colaboradores c
JOIN auth.users u ON u.id = c.user_id
JOIN core.permissions p ON p.tenant_id = c.tenant_id AND p.chave = 'finance.faturamento.lixeira.restore'
WHERE c.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND u.email IN (
    -- sócios
    'bruna.bogucheski@vlma.com.br',
    'douglas.vosgerau@vlma.com.br',
    'filipe@voalegal.com.br',
    'leonardo.orth@vlma.com.br',
    'luana.caneppele@vlma.com.br',
    'mariana.teixeira@vlma.com.br',
    'renata.dilascio@vlma.com.br',
    'tiago.ecker@vlma.com.br',
    'victor.marangoni@vlma.com.br',
    -- nominais
    'bruna.fedatto@vlma.com.br',
    'cines.cavalieri@vlma.com.br',
    'larissa.quadros@vlma.com.br',
    'jessika.lira@vlma.com.br'
  )
  AND NOT EXISTS (SELECT 1 FROM core.user_permissions up
                   WHERE up.tenant_id=c.tenant_id AND up.user_id=c.user_id AND up.permission_id=p.id);

-- ---------------------------------------------------------------------
-- 2. Permissão NOMINAL: concessão direta ou por role, nunca pelo atalho de
--    categoria da get_user_permissions (ver cabeçalho).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance._tem_permissao_nominal(p_user_id uuid, p_chave text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'core', 'public'
AS $function$
  WITH tu AS (
    SELECT tenant_id FROM core.tenant_users
    WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM core.user_permissions up
    JOIN core.permissions perm ON perm.id = up.permission_id
    JOIN tu ON tu.tenant_id = up.tenant_id AND tu.tenant_id = perm.tenant_id
    WHERE up.user_id = p_user_id AND perm.chave = p_chave
  ) OR EXISTS (
    SELECT 1
    FROM core.user_roles ur
    JOIN core.role_permissions rp ON rp.role_id = ur.role_id
    JOIN core.permissions perm ON perm.id = rp.permission_id
    JOIN tu ON tu.tenant_id = ur.tenant_id AND tu.tenant_id = perm.tenant_id
    WHERE ur.user_id = p_user_id AND perm.chave = p_chave
  );
$function$;

REVOKE ALL ON FUNCTION finance._tem_permissao_nominal(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Lista da lixeira. Mesma visibilidade da Revisão/fila
--    (finance.escopo_faturamento): vê tudo, ou só a própria área — área do
--    autor do lançamento ou centro de custo (rateio) do caso.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lixeira_faturamento(
  p_user_id uuid, p_busca text DEFAULT NULL, p_mes date DEFAULT NULL
)
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

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.excluido_em DESC), '[]'::jsonb)
  INTO v_itens
  FROM (
    SELECT
      t.excluido_faturamento_em AS excluido_em,
      jsonb_build_object(
        'timesheet_id', t.id,
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
        'data_lancamento', t.data_lancamento,
        'horas', COALESCE(t.horas, 0),
        'descricao', COALESCE(t.descricao, ''),
        'excluido_por_id', t.excluido_faturamento_por,
        'excluido_por_nome', COALESCE(exc.nome, ''),
        'excluido_em', t.excluido_faturamento_em,
        'motivo', t.excluido_faturamento_motivo,
        -- Competência em que estava quando saiu (regra da fila).
        'mes_original', mo.mes,
        -- Para onde volta ao restaurar (mesma regra de restaurar_timesheets_lixeira).
        'mes_destino', GREATEST(date_trunc('month', CURRENT_DATE)::date, mo.mes),
        'expira_em', t.excluido_faturamento_em + interval '12 months',
        'dias_restantes', GREATEST(0, ceil(EXTRACT(EPOCH FROM (t.excluido_faturamento_em + interval '12 months' - now())) / 86400.0))::int,
        -- Aviso antes de restaurar: o mês original já tem kit (item
        -- aprovado/faturado do caso) e/ou NFS-e viva sobre ele. Mesma regra
        -- de competência e de NFS-e de excluir_kit.
        'kit_no_mes_original', kit.tem_kit,
        'nfse_no_mes_original', nf.nfse_numero
      ) AS item
    FROM operations.timesheets t
    JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores aut ON aut.user_id = t.created_by AND aut.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores exc ON exc.user_id = t.excluido_faturamento_por AND exc.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT date_trunc('month', COALESCE(t.periodo_faturamento, t.data_lancamento::date))::date AS mes
    ) mo
    LEFT JOIN LATERAL (
      SELECT array_agg(bi.id) AS ids, count(*) > 0 AS tem_kit
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.status IN ('aprovado', 'faturado')
        AND bi.contrato_id = t.contrato_id
        AND bi.caso_id IS NOT DISTINCT FROM t.caso_id
        AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = mo.mes
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
    WHERE t.tenant_id = v_tenant_id
      AND t.excluido_faturamento
      AND t.excluido_faturamento_em >= now() - interval '12 months'
      AND (
        v_can_view_all
        OR aut.area_id = v_viewer_area_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      AND (v_mes IS NULL OR mo.mes = v_mes)
      AND (
        v_busca IS NULL
        OR cli.nome ILIKE '%' || v_busca || '%'
        OR c.nome_contrato ILIKE '%' || v_busca || '%'
        OR cs.nome ILIKE '%' || v_busca || '%'
        OR c.numero::text ILIKE '%' || v_busca || '%'
        OR COALESCE(c.numero_sequencial, c.numero)::text ILIKE '%' || v_busca || '%'
        OR cs.numero::text ILIKE '%' || v_busca || '%'
        OR t.descricao ILIKE '%' || v_busca || '%'
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

-- ---------------------------------------------------------------------
-- 4. Restaurar: tira a marca de excluído e põe o lançamento na fila do mês
--    corrente. Só mexe no que o usuário enxerga na lixeira (mesmo escopo e
--    mesma janela de 12 meses); o resto é ignorado e volta em 'ignorados'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restaurar_timesheets_lixeira(p_user_id uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_mes date := date_trunc('month', CURRENT_DATE)::date;
  v_count int := 0;
  v_pedidos int := COALESCE(array_length(p_ids, 1), 0);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT e.tenant_id, e.can_view_all, e.viewer_area_id
  INTO v_tenant_id, v_can_view_all, v_viewer_area_id
  FROM finance.escopo_faturamento(p_user_id) e;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT finance._tem_permissao_nominal(p_user_id, 'finance.faturamento.lixeira.restore') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar lançamentos da lixeira do faturamento';
  END IF;

  -- Mesmo efeito de postergar_timesheet (20260812120000): a competência do
  -- timesheet na fila é COALESCE(periodo_faturamento, data_lancamento), então
  -- gravar periodo_faturamento = mês corrente o põe na fila deste mês.
  -- postergar_timesheet também cancela um billing_item ativo; aqui isso não
  -- acontece — a exclusão só marca timesheet SEM billing_item ativo, e a
  -- fila não gera item de lançamento excluído. Mesmo assim, por garantia, um
  -- timesheet com billing_item ativo não é tocado (contaria em dobro).
  UPDATE operations.timesheets t
  SET excluido_faturamento = false,
      excluido_faturamento_por = NULL,
      excluido_faturamento_em = NULL,
      excluido_faturamento_motivo = NULL,
      -- Mês original já passou -> mês corrente. Ainda não chegou (hora do mês
      -- corrente tem competência no mês seguinte, ver
      -- operations._periodo_faturamento_padrao) -> fica onde estava: restaurar
      -- não pode ADIANTAR a cobrança.
      periodo_faturamento = GREATEST(v_mes, COALESCE(t.periodo_faturamento, t.data_lancamento::date)),
      updated_at = now(),
      updated_by = p_user_id
  FROM contracts.casos cs
  WHERE t.tenant_id = v_tenant_id
    AND t.id = ANY(p_ids)
    AND t.excluido_faturamento
    AND t.excluido_faturamento_em >= now() - interval '12 months'
    AND cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
    AND (
      v_can_view_all
      OR EXISTS (
        SELECT 1 FROM people.colaboradores aut
        WHERE aut.user_id = t.created_by AND aut.tenant_id = v_tenant_id
          AND aut.area_id = v_viewer_area_id
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
        WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
        AND bi.origem_id = t.id AND bi.status <> 'cancelado'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'afetados', v_count,
    'ignorados', GREATEST(v_pedidos - v_count, 0),
    'mes_corrente', v_mes
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. excluir_timesheets_do_faturamento: excluir continua igual
--    (finance.faturamento.write); desfazer (p_excluir = false) passa pela
--    lixeira. Também não re-exclui o que já está na lixeira — senão o
--    carimbo de quem/quando (e a contagem dos 12 meses) seria sobrescrito.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_timesheets_do_faturamento(p_user_id uuid, p_ids uuid[], p_excluir boolean DEFAULT true, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_count int := 0;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Desfazer a exclusão = restaurar da lixeira: permissão própria
  -- (finance.faturamento.lixeira.restore), janela de 12 meses e volta no mês
  -- corrente. Antes bastava finance.faturamento.write.
  IF NOT COALESCE(p_excluir, true) THEN
    RETURN public.restaurar_timesheets_lixeira(p_user_id, p_ids);
  END IF;

  -- Mesma permissao de quem ja libera faturamento (start_faturamento_flow):
  -- excluir da fila e uma decisao do mesmo tipo, nao um papel novo.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write', 'finance.faturamento.manage',
      'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para excluir lançamentos do faturamento';
  END IF;

  UPDATE operations.timesheets t
  SET excluido_faturamento = true,
      excluido_faturamento_por = p_user_id,
      excluido_faturamento_em = now(),
      excluido_faturamento_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
      updated_at = now(),
      updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND t.id = ANY(p_ids)
    AND NOT t.excluido_faturamento
    -- Uma vez ja faturado (existe billing_item ativo apontando pra ele) a
    -- exclusao daqui nao tem efeito nenhum — a linha ja saiu da fila. Evita a
    -- falsa sensacao de ter excluido algo que na verdade ja foi liberado.
    AND NOT EXISTS (
      SELECT 1 FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
        AND bi.origem_id = t.id AND bi.status <> 'cancelado'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('afetados', v_count);
END;
$function$;
