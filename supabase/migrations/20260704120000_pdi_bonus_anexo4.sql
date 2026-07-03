-- Bloco 2 — painel de Bônus e PLR (Anexo 4 do PDP).
-- Bônus cadastrados manualmente pelo gestor (questionário Q11): 13º, Bônus PDI, PLR Plus, Comercial.
-- PLR (35% uniforme) é apuração no nível do escritório, não por pessoa — fica como informação.

ALTER TABLE people.avaliacoes_pdi ADD COLUMN IF NOT EXISTS bonus_13o numeric;

-- Refatora salvar_avaliacao_gestor: bônus vira p_bonus jsonb (sem overload futuro ao crescer o painel).
DROP FUNCTION IF EXISTS public.salvar_avaliacao_gestor(uuid,jsonb,jsonb,varchar,text,text,boolean,numeric,numeric,boolean);

CREATE OR REPLACE FUNCTION public.salvar_avaliacao_gestor(
  p_avaliacao_id uuid, p_skills jsonb, p_metas jsonb,
  p_faixa_final_geral varchar, p_resultado text, p_parecer text,
  p_bonus jsonb, p_enviar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid; v_item jsonb; v_nome varchar;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;
  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'Avaliação não encontrada';
  END IF;

  -- skills: coluna do gestor
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_skills,'[]'::jsonb)) LOOP
    UPDATE people.avaliacoes_pdi_skills_carreira
      SET faixa_final=NULLIF(v_item->>'faixa_final',''), texto_final=v_item->>'texto_final', updated_at=now()
      WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
  END LOOP;

  -- metas: faixa final + validação
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_metas,'[]'::jsonb)) LOOP
    UPDATE people.avaliacoes_pdi_metas_individuais
      SET faixa_final=NULLIF(v_item->>'faixa_final',''),
          validada=COALESCE((v_item->>'validada')::boolean,false), updated_at=now()
      WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
  END LOOP;

  SELECT nome INTO v_nome FROM people.colaboradores WHERE user_id=auth.uid() AND tenant_id=v_tenant LIMIT 1;

  UPDATE people.avaliacoes_pdi SET
    faixa_final_geral = NULLIF(p_faixa_final_geral,''),
    resultado = NULLIF(p_resultado,'')::people.avaliacao_pdi_resultado,
    parecer_gestor = p_parecer,
    bonus_13o = NULLIF(p_bonus->>'b13','')::numeric,
    bonus_pdi = COALESCE((p_bonus->>'pdi')::boolean, bonus_pdi),
    bonus_performance_plus = NULLIF(p_bonus->>'plr_plus','')::numeric,
    bonus_comercial = NULLIF(p_bonus->>'comercial','')::numeric,
    gestor_user_id = auth.uid(),
    gestor_nome = COALESCE(v_nome, gestor_nome),
    updated_at = now(),
    status = CASE WHEN p_enviar THEN 'avaliacao_concluida'
                  WHEN status = 'autoavaliacao_enviada' THEN 'em_avaliacao_gestor'
                  ELSE status END,
    avaliacao_gestor_enviada_at = CASE WHEN p_enviar THEN now() ELSE avaliacao_gestor_enviada_at END
    WHERE id=p_avaliacao_id;

  RETURN jsonb_build_object('id', p_avaliacao_id, 'enviada', p_enviar);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.salvar_avaliacao_gestor(uuid,jsonb,jsonb,varchar,text,text,jsonb,boolean) TO authenticated;

-- get_avaliacao_pdi_gestor: incluir bonus_13o no header
CREATE OR REPLACE FUNCTION public.get_avaliacao_pdi_gestor(p_avaliacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid; v_carreira varchar;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;
  SELECT carreira_codigo INTO v_carreira FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;

  RETURN jsonb_build_object(
    'avaliacao', (SELECT to_jsonb(x) FROM (
        SELECT a.id, a.ano, a.status, a.bloqueada, a.faixa_final_geral, a.resultado::text AS resultado,
               a.parecer_gestor, a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at,
               a.gestor_nome, a.progressao_aplicada_at, a.novo_salario, a.novo_cargo_id, a.salario_anterior,
               a.bonus_pdi, a.bonus_13o, a.bonus_performance_plus, a.bonus_comercial,
               a.cargo_id_snapshot, a.cargo_nome_snapshot, a.nivel_codigo_snapshot, a.carreira_codigo,
               a.adicional_snapshot, a.area_nome_snapshot,
               col.nome AS colaborador_nome, col.salario AS salario_atual, col.cargo_id AS cargo_atual_id
        FROM people.avaliacoes_pdi a
        JOIN people.colaboradores col ON col.id = a.colaborador_id
        WHERE a.id = p_avaliacao_id) x),
    'regua', (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id=v_tenant),
    'skills', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.trilha, s.pilar_numero, s.item_codigo),'[]'::jsonb) FROM people.avaliacoes_pdi_skills_carreira s WHERE s.avaliacao_pdi_id=p_avaliacao_id),
    'dna', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.numero),'[]'::jsonb) FROM people.avaliacoes_pdi_dna_vlma d WHERE d.avaliacao_pdi_id=p_avaliacao_id),
    'metas', (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.semestre, m.ordem, m.created_at),'[]'::jsonb) FROM people.avaliacoes_pdi_metas_individuais m WHERE m.avaliacao_pdi_id=p_avaliacao_id),
    'feedbacks', (SELECT COALESCE(jsonb_agg(to_jsonb(fb) ORDER BY fb.mes),'[]'::jsonb) FROM people.avaliacoes_pdi_feedbacks_mensais fb WHERE fb.avaliacao_pdi_id=p_avaliacao_id),
    'cargos', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.nivel, c.nome),'[]'::jsonb) FROM (
        SELECT ca.id, ca.nome, ca.codigo, ca.nivel,
               (SELECT qr.salario FROM people.pdi_quadro_remuneracao qr
                 WHERE qr.tenant_id=v_tenant AND qr.carreira_codigo=v_carreira AND qr.cargo_codigo=ca.codigo AND qr.coluna='I'
                 LIMIT 1) AS salario_sugerido
        FROM people.cargos ca WHERE ca.tenant_id=v_tenant AND ca.ativo IS NOT FALSE) c)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_avaliacao_pdi_gestor(uuid) TO authenticated;
