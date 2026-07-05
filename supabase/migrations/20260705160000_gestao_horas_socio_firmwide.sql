-- Timesheet · Gestão de horas: sócio/admin SEM área agora vê o escritório inteiro
-- (todas as áreas agregadas), em vez de ficar escondido por area_id IS NULL.
-- Coordenador continua escopado à sua área.

CREATE OR REPLACE FUNCTION public.get_gestao_horas(p_user_id uuid, p_ref_month date DEFAULT NULL::date, p_cliente_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_tenant_id uuid;
  v_area_id uuid;
  v_categoria text;
  v_eh_coord boolean;
  v_is_socio boolean;
  v_is_gestor boolean;
  v_firm_wide boolean;
  v_ms date := date_trunc('month', COALESCE(p_ref_month, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  v_me date := (date_trunc('month', COALESCE(p_ref_month, (now() AT TIME ZONE 'America/Sao_Paulo')::date)) + interval '1 month')::date;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT area_id, categoria::text, eh_coordenador
  INTO v_area_id, v_categoria, v_eh_coord
  FROM people.colaboradores WHERE user_id = p_user_id AND tenant_id = v_tenant_id LIMIT 1;

  v_is_socio := COALESCE(v_categoria = 'socio', false) OR COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  v_is_gestor := v_is_socio OR COALESCE(v_eh_coord, false);
  -- sócio/admin sem área => visão do escritório inteiro
  v_firm_wide := v_is_socio AND v_area_id IS NULL;

  -- não-gestor, ou coordenador sem área (misconfig): esconde
  IF NOT v_is_gestor OR (v_area_id IS NULL AND NOT v_firm_wide) THEN
    RETURN jsonb_build_object('is_gestor', false);
  END IF;

  RETURN (
    WITH equipe AS (
      SELECT c.id, c.user_id, c.nome
      FROM people.colaboradores c
      WHERE c.tenant_id = v_tenant_id AND c.ativo
        AND (v_firm_wide OR c.area_id = v_area_id)
    ),
    ts AS (
      SELECT
        t.created_by,
        eq.nome AS pessoa_nome,
        cli.nome AS cliente_nome,
        (cs.numero::text || ' — ' || cs.nome) AS caso_label,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h_lancadas,
        COALESCE(t.horas_aprovadas, 0) AS h_aprovadas,
        COALESCE(NULLIF(cs.regra_cobranca_config->>'valor_hora','')::numeric, 0) AS valor_hora
      FROM operations.timesheets t
      JOIN equipe eq ON eq.user_id = t.created_by
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = t.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id
        AND t.data_lancamento >= v_ms AND t.data_lancamento < v_me
        AND (p_cliente_id IS NULL OR ct.cliente_id = p_cliente_id)
    )
    SELECT jsonb_build_object(
      'is_gestor', true,
      'firm_wide', v_firm_wide,
      'area_id', v_area_id,
      'area_nome', CASE WHEN v_firm_wide THEN 'Escritório (todas as áreas)' ELSE (SELECT nome FROM people.areas WHERE id = v_area_id) END,
      'equipe_count', (SELECT count(*) FROM equipe),
      'minhas', (SELECT jsonb_build_object(
          'horas', COALESCE(sum(h_lancadas),0), 'horas_aprovadas', COALESCE(sum(h_aprovadas),0),
          'valor_projetado', COALESCE(sum(h_lancadas*valor_hora),0), 'valor_aprovado', COALESCE(sum(h_aprovadas*valor_hora),0)
        ) FROM ts WHERE created_by = p_user_id),
      'equipe_total', (SELECT jsonb_build_object(
          'horas', COALESCE(sum(h_lancadas),0), 'horas_aprovadas', COALESCE(sum(h_aprovadas),0),
          'valor_projetado', COALESCE(sum(h_lancadas*valor_hora),0), 'valor_aprovado', COALESCE(sum(h_aprovadas*valor_hora),0)
        ) FROM ts),
      'por_pessoa', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'label', pessoa_nome, 'horas', h, 'horas_aprovadas', ha, 'valor_projetado', vp, 'valor_aprovado', va
        ) ORDER BY h DESC) FROM (
          SELECT pessoa_nome, sum(h_lancadas) h, sum(h_aprovadas) ha, sum(h_lancadas*valor_hora) vp, sum(h_aprovadas*valor_hora) va
          FROM ts GROUP BY pessoa_nome) s), '[]'::jsonb),
      'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'label', COALESCE(cliente_nome,'Sem cliente'), 'horas', h, 'horas_aprovadas', ha, 'valor_projetado', vp, 'valor_aprovado', va
        ) ORDER BY h DESC) FROM (
          SELECT cliente_nome, sum(h_lancadas) h, sum(h_aprovadas) ha, sum(h_lancadas*valor_hora) vp, sum(h_aprovadas*valor_hora) va
          FROM ts GROUP BY cliente_nome) s), '[]'::jsonb),
      'por_caso', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'label', COALESCE(caso_label,'Sem caso'), 'horas', h, 'horas_aprovadas', ha, 'valor_projetado', vp, 'valor_aprovado', va
        ) ORDER BY h DESC) FROM (
          SELECT caso_label, sum(h_lancadas) h, sum(h_aprovadas) ha, sum(h_lancadas*valor_hora) vp, sum(h_aprovadas*valor_hora) va
          FROM ts GROUP BY caso_label) s), '[]'::jsonb),
      'clientes', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', ct.cliente_id, 'nome', cli.nome))
          FROM operations.timesheets t
          JOIN people.colaboradores eq ON eq.user_id = t.created_by AND eq.tenant_id = v_tenant_id AND (v_firm_wide OR eq.area_id = v_area_id)
          JOIN contracts.contratos ct ON ct.id = t.contrato_id
          JOIN crm.clientes cli ON cli.id = ct.cliente_id
          WHERE t.tenant_id = v_tenant_id), '[]'::jsonb)
    )
  );
END;
$function$;
