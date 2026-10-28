-- Timesheet: caso inativo não recebe lançamento (Filipe 28/10).
-- A tela filtrava só contrato inativo, as sugestões também ofereciam o caso
-- e o banco não recusava. Funções partem das definições de produção de 28/10.

CREATE OR REPLACE FUNCTION public.create_timesheet(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_cargo_id uuid;
  v_ia boolean := COALESCE(NULLIF(p_payload->>'ia_auxiliado', '')::boolean, false);
  v_minutos integer;
BEGIN
  -- Quem chama direto pelo PostgREST (authenticated) não escolhe em nome de
  -- quem lança: vale o usuário do JWT. As edges usam service role (auth.uid()
  -- nulo) e passam o user.id do token já validado, então seguem iguais.
  p_user_id := COALESCE(auth.uid(), p_user_id);

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

  -- Caso ou contrato inativo não recebe lançamento novo (Filipe 28/10: o ERP
  -- deixava lançar horas em caso inativo — a tela só filtrava o contrato).
  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
      JOIN contracts.contratos ct ON ct.id = cs.contrato_id
     WHERE cs.id = (p_payload->>'caso_id')::uuid
       AND cs.contrato_id = (p_payload->>'contrato_id')::uuid
       AND cs.tenant_id = v_tenant_id
       AND cs.status = 'ativo' AND ct.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Caso inativo: não é possível lançar horas nele.';
  END IF;

  -- Fração de 5 minutos (out/2026).
  v_minutos := COALESCE(
    NULLIF(p_payload->>'duracao_minutos', '')::integer,
    round(COALESCE(NULLIF(p_payload->>'horas', '')::numeric, 0) * 60)::integer
  );
  IF v_minutos IS NULL OR v_minutos <= 0 THEN
    RAISE EXCEPTION 'Informe a duração do lançamento (horas e/ou minutos)';
  END IF;
  IF v_minutos % 5 <> 0 THEN
    RAISE EXCEPTION 'Duração de % min não é aceita. A fração só pode ser de 5 em 5 minutos.', v_minutos;
  END IF;

  -- Congela o cargo de quem está lançando, agora.
  SELECT c.cargo_id INTO v_cargo_id
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
  LIMIT 1;

  INSERT INTO operations.timesheets (
    tenant_id, contrato_id, caso_id, data_lancamento, horas, duracao_minutos,
    descricao, ia_auxiliado, ia_minutos, cargo_id, status, created_by, updated_by
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
    v_cargo_id,
    'em_lancamento',
    p_user_id,
    p_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$
;

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
  v_min_atual integer;
  v_min_novo integer;
BEGIN
  -- Quem chama direto pelo PostgREST (authenticated) não escolhe em nome de
  -- quem lança: vale o usuário do JWT. As edges usam service role (auth.uid()
  -- nulo) e passam o user.id do token já validado, então seguem iguais.
  p_user_id := COALESCE(auth.uid(), p_user_id);

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
    AND t.tenant_id = v_tenant_id
    -- Lixeira etapa 2 (20261021140000): lançamento apagado não se edita.
    AND t.apagado_em IS NULL;

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

  -- Fração de 5 minutos (out/2026): só quando a duração muda. Lançamento
  -- antigo fora da fração continua editável se a duração for mantida.
  v_min_atual := COALESCE(v_current.duracao_minutos, round(v_current.horas * 60)::integer);
  v_min_novo := COALESCE(
    NULLIF(p_payload->>'duracao_minutos', '')::integer,
    round(NULLIF(p_payload->>'horas', '')::numeric * 60)::integer,
    v_min_atual
  );
  IF v_min_novo IS DISTINCT FROM v_min_atual THEN
    IF v_min_novo <= 0 THEN
      RAISE EXCEPTION 'Informe a duração do lançamento (horas e/ou minutos)';
    END IF;
    IF v_min_novo % 5 <> 0 THEN
      RAISE EXCEPTION 'Duração de % min não é aceita. A fração só pode ser de 5 em 5 minutos.', v_min_novo;
    END IF;
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

  -- Trocar o lançamento para um caso inativo também não pode (Filipe 28/10).
  -- Editar um lançamento que já estava no caso, sem trocar, continua valendo.
  IF v_new_caso_id IS DISTINCT FROM v_current.caso_id AND NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
      JOIN contracts.contratos ct ON ct.id = cs.contrato_id
     WHERE cs.id = v_new_caso_id AND cs.status = 'ativo' AND ct.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Caso inativo: não é possível lançar horas nele.';
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

CREATE OR REPLACE FUNCTION public.get_sugestoes_timesheet()
 RETURNS TABLE(caso_id uuid, contrato_id uuid, caso_numero integer, caso_nome text, descricao text, vezes integer, ultimo_uso date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'contracts', 'core'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tu.tenant_id INTO v_tenant FROM core.tenant_users tu
   WHERE tu.user_id = v_uid AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN QUERY
  SELECT
    t.caso_id,
    t.contrato_id,
    cs.numero::integer,
    cs.nome::text,
    (array_agg(btrim(t.descricao) ORDER BY t.data_lancamento DESC, t.created_at DESC))[1]::text,
    count(*)::integer,
    max(t.data_lancamento)
  FROM operations.timesheets t
  JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant
  JOIN contracts.contratos ct ON ct.id = t.contrato_id AND ct.tenant_id = v_tenant
  WHERE t.apagado_em IS NULL  -- Lixeira etapa 2
      AND t.tenant_id = v_tenant
    AND t.created_by = v_uid
    AND t.data_lancamento >= (current_date - interval '3 months')::date
    AND ct.status = 'ativo'
    AND cs.status = 'ativo'  -- sugestão não leva a caso inativo (Filipe 28/10)
    AND btrim(coalesce(t.descricao, '')) <> ''
  GROUP BY t.caso_id, t.contrato_id, cs.numero, cs.nome,
           lower(regexp_replace(btrim(t.descricao), '\s+', ' ', 'g'))
  ORDER BY count(*) DESC, max(t.data_lancamento) DESC
  LIMIT 20;
END;
$function$
;
