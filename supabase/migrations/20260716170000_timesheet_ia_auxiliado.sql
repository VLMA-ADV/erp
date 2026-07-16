-- Pedido do cliente (16/07): campo "Auxiliado por IA" no lançamento de
-- timesheet, com "quanto tempo?" quando sim. O dado fica registrado na
-- origem para medição futura e NÃO aparece nas etapas de revisão/aprovação
-- (get_revisao_fatura e snapshots não expõem esses campos).
-- Aproveita para persistir duracao_minutos, que o front já enviava mas as
-- RPCs ignoravam (o valor era derivado de horas com arredondamento).

ALTER TABLE operations.timesheets
  ADD COLUMN IF NOT EXISTS ia_auxiliado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_minutos integer;

CREATE OR REPLACE FUNCTION public.create_timesheet(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_ia boolean := COALESCE(NULLIF(p_payload->>'ia_auxiliado', '')::boolean, false);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NULLIF(p_payload->>'contrato_id', '') IS NULL OR NULLIF(p_payload->>'caso_id', '') IS NULL THEN
    RAISE EXCEPTION 'Contrato e caso são obrigatórios';
  END IF;

  INSERT INTO operations.timesheets (
    tenant_id,
    contrato_id,
    caso_id,
    data_lancamento,
    horas,
    duracao_minutos,
    descricao,
    ia_auxiliado,
    ia_minutos,
    status,
    created_by,
    updated_by
  ) VALUES (
    v_tenant_id,
    (p_payload->>'contrato_id')::uuid,
    (p_payload->>'caso_id')::uuid,
    COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, now()::date),
    COALESCE(NULLIF(p_payload->>'horas', '')::numeric, 0),
    NULLIF(p_payload->>'duracao_minutos', '')::integer,
    COALESCE(NULLIF(p_payload->>'descricao', ''), ''),
    v_ia,
    CASE WHEN v_ia THEN NULLIF(p_payload->>'ia_minutos', '')::integer ELSE NULL END,
    'em_lancamento',
    p_user_id,
    p_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

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

  -- Só permite carregar o timesheet se for do próprio usuário.
  SELECT * INTO v_current
  FROM operations.timesheets t
  WHERE t.id = p_timesheet_id
    AND t.tenant_id = v_tenant_id
    AND t.created_by = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet não encontrado para edição pelo usuário';
  END IF;

  IF v_current.status <> 'em_lancamento' THEN
    RAISE EXCEPTION 'Timesheet só pode ser editado em lançamento pelo criador';
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
    AND t.tenant_id = v_tenant_id
    AND t.created_by = p_user_id;

  RETURN jsonb_build_object('id', p_timesheet_id);
END;
$function$;

-- get_timesheets passa a devolver duracao_minutos (exibição h/min sem
-- arredondamento) e os campos de IA — usados apenas para pré-preencher o
-- formulário de edição do próprio autor; a tabela não os exibe.
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
$function$;
