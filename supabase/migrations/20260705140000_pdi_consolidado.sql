-- PDI Fase 3 — RPC de consolidação (dashboard do gestor/sócio).
-- Espelha a referência pdivlma.netlify.app: KPIs, "onde atuar", por área/hierarquia,
-- distribuição por faixa, status de feedbacks, ranking de pessoas, scatter autoaval×progresso.
-- "Projetos/ações" = metas do PDI; "progresso" = metas.progresso_pct; "autoavaliação" = metas.faixa_auto.

CREATE OR REPLACE FUNCTION public.get_pdi_consolidado(p_ano int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para ver a consolidação'; END IF;

  RETURN jsonb_build_object(
    'ano', p_ano,
    'kpis', (SELECT to_jsonb(k) FROM (
      SELECT
        (SELECT count(DISTINCT NULLIF(area_nome_snapshot,'')) FROM people.avaliacoes_pdi WHERE tenant_id=v_tenant AND ano=p_ano)::int AS areas,
        (SELECT count(*) FROM people.avaliacoes_pdi WHERE tenant_id=v_tenant AND ano=p_ano)::int AS pessoas,
        (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano)::int AS projetos,
        (SELECT COALESCE(round(avg(m.progresso_pct)),0) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano)::int AS progresso_medio,
        (SELECT count(*) FROM people.avaliacoes_pdi_feedbacks_mensais f JOIN people.avaliacoes_pdi a ON a.id=f.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND f.realizado)::int AS feedback_realizado,
        (SELECT count(*) FROM people.avaliacoes_pdi_feedbacks_mensais f JOIN people.avaliacoes_pdi a ON a.id=f.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND NOT f.realizado)::int AS pendentes
    ) k),
    'onde_atuar', (SELECT to_jsonb(o) FROM (
      SELECT
        (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND COALESCE(m.progresso_pct,0)<30)::int AS criticos,
        (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND m.progresso_pct BETWEEN 30 AND 60)::int AS em_risco,
        (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND m.faixa_auto IN ('acima_do_esperado','fora_da_curva') AND COALESCE(m.progresso_pct,0)<50)::int AS discrepancias,
        (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND m.faixa_auto='a_melhorar')::int AS a_melhorar
    ) o),
    'por_area', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.progresso DESC, x.nome),'[]'::jsonb) FROM (
      SELECT COALESCE(NULLIF(a.area_nome_snapshot,''),'Sem área') AS nome,
             count(DISTINCT a.colaborador_id)::int AS pessoas,
             count(m.id)::int AS projetos,
             COALESCE(round(avg(m.progresso_pct)),0)::int AS progresso
      FROM people.avaliacoes_pdi a
      LEFT JOIN people.avaliacoes_pdi_metas_individuais m ON m.avaliacao_pdi_id=a.id
      WHERE a.tenant_id=v_tenant AND a.ano=p_ano GROUP BY 1) x),
    'por_hierarquia', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.progresso DESC),'[]'::jsonb) FROM (
      SELECT COALESCE(NULLIF(a.nivel_codigo_snapshot,''),'—') AS nome,
             COALESCE(round(avg(m.progresso_pct)),0)::int AS progresso
      FROM people.avaliacoes_pdi a
      LEFT JOIN people.avaliacoes_pdi_metas_individuais m ON m.avaliacao_pdi_id=a.id
      WHERE a.tenant_id=v_tenant AND a.ano=p_ano GROUP BY 1) x),
    'por_faixa', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.ordem),'[]'::jsonb) FROM (
      SELECT f.rotulo AS nome, f.ordem, f.codigo,
             (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND m.faixa_auto=f.codigo)::int AS total
      FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id=v_tenant) x),
    'status_projetos', (SELECT to_jsonb(s) FROM (
      SELECT
        (SELECT count(*) FROM people.avaliacoes_pdi_feedbacks_mensais f JOIN people.avaliacoes_pdi a ON a.id=f.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND f.realizado)::int AS feedback_realizado,
        (SELECT count(*) FROM people.avaliacoes_pdi_feedbacks_mensais f JOIN people.avaliacoes_pdi a ON a.id=f.avaliacao_pdi_id WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND NOT f.realizado)::int AS pendente
    ) s),
    'ranking', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.progresso DESC),'[]'::jsonb) FROM (
      SELECT col.nome, COALESCE(round(avg(m.progresso_pct)),0)::int AS progresso
      FROM people.avaliacoes_pdi a
      JOIN people.colaboradores col ON col.id=a.colaborador_id
      LEFT JOIN people.avaliacoes_pdi_metas_individuais m ON m.avaliacao_pdi_id=a.id
      WHERE a.tenant_id=v_tenant AND a.ano=p_ano GROUP BY col.nome) x),
    'scatter', (SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
      SELECT m.progresso_pct::int AS progresso,
             CASE m.faixa_auto WHEN 'baixa_performance' THEN 1 WHEN 'a_melhorar' THEN 2 WHEN 'dentro_da_media' THEN 3 WHEN 'acima_do_esperado' THEN 4 WHEN 'fora_da_curva' THEN 5 ELSE NULL END AS auto
      FROM people.avaliacoes_pdi_metas_individuais m JOIN people.avaliacoes_pdi a ON a.id=m.avaliacao_pdi_id
      WHERE a.tenant_id=v_tenant AND a.ano=p_ano AND m.progresso_pct IS NOT NULL AND m.faixa_auto IS NOT NULL) x),
    'areas_detalhe', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nome),'[]'::jsonb) FROM (
      SELECT COALESCE(NULLIF(a.area_nome_snapshot,''),'Sem área') AS nome,
             jsonb_agg(DISTINCT jsonb_build_object('pessoa', col.nome)) AS pessoas
      FROM people.avaliacoes_pdi a JOIN people.colaboradores col ON col.id=a.colaborador_id
      WHERE a.tenant_id=v_tenant AND a.ano=p_ano GROUP BY 1) x)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_pdi_consolidado(int) TO authenticated;
