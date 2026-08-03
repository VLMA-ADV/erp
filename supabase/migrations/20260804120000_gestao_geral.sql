-- Gestão Geral (pedido Filipe 03/08): visão do escritório inteiro, com
-- filtros por centro de custo, pessoa e cliente.
--
-- Acesso: todos os SÓCIOS (por categoria) + Jessika (grant nominal via
-- capacidade sensível). Permissão comum não serve: sócio/administrativo
-- herdam todas, e os demais administrativos entrariam junto.
--
-- Inclui TODOS os colaboradores ativos, mesmo com 0h no mês — quem não
-- lançou é justamente quem o painel precisa mostrar.

INSERT INTO core.capacidades_sensiveis (tenant_id, user_id, capacidade)
SELECT c.tenant_id, c.user_id, 'operations.gestao_geral'
FROM people.colaboradores c
WHERE c.ativo AND c.user_id IS NOT NULL
  AND c.nome ILIKE 'Jessika Lira%'
  AND NOT EXISTS (
    SELECT 1 FROM core.capacidades_sensiveis g
    WHERE g.user_id = c.user_id AND g.capacidade = 'operations.gestao_geral'
  );

CREATE OR REPLACE FUNCTION public.get_gestao_geral(
  p_user_id  uuid,
  p_ref_month date DEFAULT NULL,
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'operations', 'people', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_categoria text;
  v_ini date;
  v_fim date;
  v_area_f uuid := NULLIF(p_filters->>'area_id', '')::uuid;
  v_pessoa_f uuid := NULLIF(p_filters->>'pessoa_user_id', '')::uuid;
  v_cliente_f uuid := NULLIF(p_filters->>'cliente_id', '')::uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  SELECT c.categoria::text INTO v_categoria
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
  LIMIT 1;

  IF NOT (v_categoria = 'socio'
          OR public.tem_capacidade_sensivel(p_user_id, 'operations.gestao_geral')) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  v_ini := date_trunc('month', COALESCE(p_ref_month, now()::date))::date;
  v_fim := (v_ini + interval '1 month' - interval '1 day')::date;

  RETURN (
    WITH pessoas AS (
      SELECT c.id, c.user_id, c.nome, c.area_id, a.nome AS area_nome
      FROM people.colaboradores c
      LEFT JOIN people.areas a ON a.id = c.area_id AND a.tenant_id = v_tenant_id
      WHERE c.tenant_id = v_tenant_id AND c.ativo AND c.user_id IS NOT NULL
        AND (v_area_f IS NULL OR c.area_id = v_area_f)
        AND (v_pessoa_f IS NULL OR c.user_id = v_pessoa_f)
    ),
    ts AS (
      SELECT
        t.created_by,
        p.nome AS pessoa_nome,
        p.area_id,
        p.area_nome,
        cli.id  AS cliente_id,
        cli.nome AS cliente_nome,
        (cs.numero::text || ' — ' || cs.nome) AS caso_label,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h_lancadas,
        COALESCE(t.horas_aprovadas, 0) AS h_aprovadas,
        COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) AS valor_hora
      FROM operations.timesheets t
      JOIN pessoas p ON p.user_id = t.created_by
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = t.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id
        AND t.data_lancamento BETWEEN v_ini AND v_fim
        AND (v_cliente_f IS NULL OR cli.id = v_cliente_f)
    )
    SELECT jsonb_build_object(
      'autorizado', true,
      'periodo', jsonb_build_object('inicio', v_ini, 'fim', v_fim),
      'totais', (
        SELECT jsonb_build_object(
          'pessoas', (SELECT count(*) FROM pessoas),
          'pessoas_com_lancamento', count(DISTINCT created_by),
          'horas', COALESCE(sum(h_lancadas), 0),
          'horas_aprovadas', COALESCE(sum(h_aprovadas), 0),
          'valor_projetado', COALESCE(sum(h_lancadas * valor_hora), 0),
          'valor_aprovado', COALESCE(sum(h_aprovadas * valor_hora), 0)
        ) FROM ts
      ),
      'por_area', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'area_id', s.area_id, 'label', s.label, 'pessoas', s.pessoas,
          'horas', s.h, 'valor_projetado', s.vp, 'valor_aprovado', s.va
        ) ORDER BY s.h DESC)
        FROM (
          SELECT p.area_id, COALESCE(p.area_nome, 'Sem centro de custo') AS label,
                 count(DISTINCT p.user_id) AS pessoas,
                 COALESCE(sum(t.h_lancadas), 0) AS h,
                 COALESCE(sum(t.h_lancadas * t.valor_hora), 0) AS vp,
                 COALESCE(sum(t.h_aprovadas * t.valor_hora), 0) AS va
          FROM pessoas p
          LEFT JOIN ts t ON t.created_by = p.user_id
          GROUP BY p.area_id, p.area_nome
        ) s
      ), '[]'::jsonb),
      'por_pessoa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', s.user_id, 'label', s.nome, 'area', s.area_nome,
          'horas', s.h, 'valor_projetado', s.vp, 'valor_aprovado', s.va
        ) ORDER BY s.h DESC, s.nome)
        FROM (
          SELECT p.user_id, p.nome, p.area_nome,
                 COALESCE(sum(t.h_lancadas), 0) AS h,
                 COALESCE(sum(t.h_lancadas * t.valor_hora), 0) AS vp,
                 COALESCE(sum(t.h_aprovadas * t.valor_hora), 0) AS va
          FROM pessoas p
          LEFT JOIN ts t ON t.created_by = p.user_id
          GROUP BY p.user_id, p.nome, p.area_nome
        ) s
      ), '[]'::jsonb),
      'por_cliente', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('label', s.cliente_nome, 'horas', s.h, 'valor_projetado', s.vp) ORDER BY s.h DESC)
        FROM (
          SELECT cliente_nome, sum(h_lancadas) AS h, sum(h_lancadas * valor_hora) AS vp
          FROM ts WHERE cliente_nome IS NOT NULL
          GROUP BY cliente_nome ORDER BY sum(h_lancadas) DESC LIMIT 15
        ) s
      ), '[]'::jsonb),
      'por_caso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('label', s.caso_label, 'horas', s.h, 'valor_projetado', s.vp) ORDER BY s.h DESC)
        FROM (
          SELECT caso_label, sum(h_lancadas) AS h, sum(h_lancadas * valor_hora) AS vp
          FROM ts WHERE caso_label IS NOT NULL
          GROUP BY caso_label ORDER BY sum(h_lancadas) DESC LIMIT 15
        ) s
      ), '[]'::jsonb),
      'filtros', jsonb_build_object(
        'areas', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome) ORDER BY a.nome)
          FROM people.areas a WHERE a.tenant_id = v_tenant_id
        ), '[]'::jsonb),
        'pessoas', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('user_id', c.user_id, 'nome', c.nome) ORDER BY c.nome)
          FROM people.colaboradores c
          WHERE c.tenant_id = v_tenant_id AND c.ativo AND c.user_id IS NOT NULL
        ), '[]'::jsonb)
      )
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_gestao_geral(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_gestao_geral(uuid, date, jsonb) TO authenticated, service_role;
