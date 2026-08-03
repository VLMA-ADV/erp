-- Quem pode editar o timesheet de quem (pedido Filipe, 03/08).
--
-- Regra combinada com o cliente:
--   · Filipe, Renata, Douglas e Jessika editam de QUALQUER pessoa;
--   · demais sócios e coordenadores editam apenas de quem é da sua área;
--   · todo mundo edita o próprio;
--   · em qualquer caso, só enquanto o lançamento não foi liberado.
--
-- Por que capacidade sensível e não permissão comum: get_user_permissions dá
-- TODAS as permissões a sócio/administrativo, então uma permissão normal
-- vazaria o poder para os 11 sócios. `tem_capacidade_sensivel` só concede por
-- grant nominal — e a lista de quem pode vira DADO, não código.
CREATE OR REPLACE FUNCTION public.pode_editar_timesheet_de(
  p_editor_user_id uuid,
  p_dono_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id   uuid;
  v_editor      record;
  v_dono_area   uuid;
BEGIN
  IF p_editor_user_id IS NULL OR p_dono_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. o próprio dono
  IF p_editor_user_id = p_dono_user_id THEN
    RETURN true;
  END IF;

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_editor_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  -- 2. capacidade nominal: edita de qualquer pessoa
  IF public.tem_capacidade_sensivel(p_editor_user_id, 'operations.timesheet.editar_todos') THEN
    RETURN true;
  END IF;

  SELECT c.categoria::text AS categoria,
         COALESCE(c.eh_coordenador, false) AS eh_coordenador,
         c.area_id
    INTO v_editor
  FROM people.colaboradores c
  WHERE c.user_id = p_editor_user_id AND c.tenant_id = v_tenant_id
  LIMIT 1;

  IF v_editor IS NULL OR v_editor.area_id IS NULL THEN
    RETURN false;
  END IF;

  -- 3. sócio ou coordenador, e o dono é da mesma área
  IF v_editor.categoria = 'socio' OR v_editor.eh_coordenador THEN
    SELECT c.area_id INTO v_dono_area
    FROM people.colaboradores c
    WHERE c.user_id = p_dono_user_id AND c.tenant_id = v_tenant_id
    LIMIT 1;

    RETURN v_dono_area IS NOT NULL AND v_dono_area = v_editor.area_id;
  END IF;

  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pode_editar_timesheet_de(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pode_editar_timesheet_de(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.pode_editar_timesheet_de(uuid, uuid) IS
  'Único juiz de quem edita/exclui timesheet de quem: próprio > capacidade nominal > gestor da mesma área.';

-- Concede a capacidade aos quatro nomeados pelo cliente.
INSERT INTO core.capacidades_sensiveis (tenant_id, user_id, capacidade)
SELECT c.tenant_id, c.user_id, 'operations.timesheet.editar_todos'
FROM people.colaboradores c
WHERE c.ativo
  AND c.user_id IS NOT NULL
  AND (
    lower(c.email) IN ('filipe@voalegal.com.br', 'renata.dilascio@vlma.com.br')
    OR c.nome ILIKE 'Douglas Ramos Vosgerau%'
    OR c.nome ILIKE 'Jessika Lira%'
    OR c.nome ILIKE 'Filipe K%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM core.capacidades_sensiveis g
    WHERE g.user_id = c.user_id
      AND g.capacidade = 'operations.timesheet.editar_todos'
  );


-- As três funções passam a consultar o mesmo juiz.
CREATE OR REPLACE FUNCTION public.update_timesheet(p_user_id uuid, p_timesheet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_current record;
  v_new_contrato_id uuid;
  v_new_caso_id uuid;
  v_new_ia boolean;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Quem pode editar é decidido por pode_editar_timesheet_de (próprio dono,
  -- capacidade nominal 'editar_todos', ou gestor da mesma área).
  SELECT * INTO v_current
  FROM operations.timesheets t
  WHERE t.id = p_timesheet_id
    AND t.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF NOT public.pode_editar_timesheet_de(p_user_id, v_current.created_by) THEN
    RAISE EXCEPTION 'Você não pode editar o lançamento de outra pessoa. Só o autor, a diretoria ou o gestor da área dele podem.';
  END IF;

  -- Decisão do cliente (03/08): edição de terceiro vale só ANTES da liberação.
  -- Depois disso o ajuste é feito na revisão de fatura, que recalcula valores.
  IF v_current.status <> 'em_lancamento' THEN
    RAISE EXCEPTION 'Este lançamento já foi liberado para faturamento. Ajuste pela tela de Revisão de fatura.';
  END IF;

  v_new_contrato_id := COALESCE(NULLIF(p_payload->>'contrato_id', '')::uuid, v_current.contrato_id);
  v_new_caso_id := COALESCE(NULLIF(p_payload->>'caso_id', '')::uuid, v_current.caso_id);
  v_new_ia := COALESCE(NULLIF(p_payload->>'ia_auxiliado', '')::boolean, v_current.ia_auxiliado);

  IF NOT EXISTS (
    SELECT 1
    FROM contracts.casos cs
    WHERE cs.id = v_new_caso_id
      AND cs.contrato_id = v_new_contrato_id
      AND cs.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Caso não pertence ao contrato informado';
  END IF;

  UPDATE operations.timesheets t
  SET
    contrato_id = v_new_contrato_id,
    caso_id = v_new_caso_id,
    data_lancamento = COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, t.data_lancamento),
    horas = COALESCE(NULLIF(p_payload->>'horas', '')::numeric, t.horas),
    duracao_minutos = COALESCE(NULLIF(p_payload->>'duracao_minutos', '')::integer, t.duracao_minutos),
    descricao = COALESCE(NULLIF(p_payload->>'descricao', ''), t.descricao),
    ia_auxiliado = v_new_ia,
    ia_minutos = CASE
      WHEN NOT v_new_ia THEN NULL
      ELSE COALESCE(NULLIF(p_payload->>'ia_minutos', '')::integer, t.ia_minutos)
    END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.id = p_timesheet_id
    AND t.tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_timesheet_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_timesheet(p_user_id uuid, p_timesheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_dono uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT status, created_by INTO v_status, v_dono
  FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  -- Antes não havia trava nenhuma: qualquer um com permissão de timesheet
  -- apagava lançamento de qualquer pessoa. Passa a valer a mesma regra da edição.
  IF NOT public.pode_editar_timesheet_de(p_user_id, v_dono) THEN
    RAISE EXCEPTION 'Você não pode excluir o lançamento de outra pessoa. Só o autor, a diretoria ou o gestor da área dele podem.';
  END IF;

  IF v_status = 'aprovado' THEN
    RAISE EXCEPTION 'Não é possível excluir um lançamento já aprovado. Reabra a revisão antes.';
  END IF;

  -- Se o lançamento já entrou na fase de revisão E alguém já mexeu nele
  -- (revisou/avançou), a exclusão é bloqueada.
  IF EXISTS (
    SELECT 1
    FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id
      AND bi.origem_tipo = 'timesheet'
      AND bi.origem_id = p_timesheet_id
      AND (
        bi.status NOT IN ('disponivel', 'em_revisao')
        OR bi.data_revisao IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM finance.revisao_fatura_itens_historico h
          WHERE h.billing_item_id = bi.id AND h.role IN ('REVISOR', 'APROVADOR')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Este lançamento já foi revisado no faturamento. Peça ao revisor para reabrir antes de excluir.';
  END IF;

  -- Cancela o item de faturamento ainda não revisado (evita item órfão na grid).
  UPDATE finance.billing_items bi
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE bi.tenant_id = v_tenant_id
    AND bi.origem_tipo = 'timesheet'
    AND bi.origem_id = p_timesheet_id
    AND bi.status IN ('disponivel', 'em_revisao');

  DELETE FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_timesheet_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_timesheets(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
  v_is_admin_socio boolean := false;
  v_eh_coord boolean := false;
  v_is_gestor boolean := false;
  v_has_manage_perm boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_is_admin_socio := public.is_admin_or_socio(p_user_id, v_tenant_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'operations.timesheet.manage',
      'operations.timesheet.*',
      'operations.*',
      '*'
    )
  ) INTO v_has_manage_perm;

  SELECT col.area_id, a.nome, COALESCE(col.eh_coordenador, false)
  INTO v_viewer_area_id, v_viewer_area_nome, v_eh_coord
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Gestor = sócio/admin OU coordenador de área (vê a própria área).
  v_is_gestor := v_is_admin_socio OR v_eh_coord;

  -- Vê tudo só quem tem permissão explícita de gestão OU é diretor
  -- (centro de custo 'VLMA' ou sem área específica). Sócio/coordenador de
  -- área específica NÃO vê tudo — fica escopado à sua área.
  v_can_view_all := v_has_manage_perm
    OR (v_is_admin_socio AND (v_viewer_area_id IS NULL OR v_viewer_area_nome = 'VLMA'));

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'contrato_id', t.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_nome', ct.nome_contrato,
        'caso_id', t.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'data_lancamento', t.data_lancamento,
        'horas', t.horas,
        'duracao_minutos', t.duracao_minutos,
        'descricao', t.descricao,
        'status', t.status,
        'ia_auxiliado', t.ia_auxiliado,
        'ia_minutos', t.ia_minutos,
        'created_by', t.created_by,
        'created_by_nome', cb.nome,
        -- Fonte única: a mesma função que o backend usa para autorizar. Evita
        -- a tela oferecer um lápis que o servidor vai recusar.
        'pode_editar', public.pode_editar_timesheet_de(p_user_id, t.created_by),
        'revisado_por', t.revisado_por,
        'aprovado_por', t.aprovado_por,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      )
      ORDER BY t.data_lancamento DESC, t.created_at DESC
    )
    FROM operations.timesheets t
    JOIN contracts.contratos ct ON ct.id = t.contrato_id
    JOIN contracts.casos cs ON cs.id = t.caso_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = t.created_by AND cb.tenant_id = t.tenant_id
    WHERE t.tenant_id = v_tenant_id
      AND (
        v_can_view_all
        OR t.created_by = p_user_id
        OR (
          -- gestor de área específica vê as horas das pessoas do seu centro de custo
          v_is_gestor
          AND v_viewer_area_id IS NOT NULL
          AND cb.area_id = v_viewer_area_id
        )
      )
      AND (
        NULLIF(p_filters->>'contrato_id', '') IS NULL
        OR t.contrato_id = (p_filters->>'contrato_id')::uuid
      )
      AND (
        NULLIF(p_filters->>'caso_id', '') IS NULL
        OR t.caso_id = (p_filters->>'caso_id')::uuid
      )
      AND (
        NULLIF(p_filters->>'status', '') IS NULL
        OR t.status = (p_filters->>'status')
      )
      AND (
        NULLIF(p_filters->>'data_inicio', '') IS NULL
        OR t.data_lancamento >= (p_filters->>'data_inicio')::date
      )
      AND (
        NULLIF(p_filters->>'data_fim', '') IS NULL
        OR t.data_lancamento <= (p_filters->>'data_fim')::date
      )
  ), '[]'::jsonb);
END;
$function$
;
