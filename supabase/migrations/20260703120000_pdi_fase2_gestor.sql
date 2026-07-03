-- PDI Fase 2 — jornada do gestor/sócio: avaliação final lado a lado, validação de metas,
-- faixa final geral -> resultado, e aplicação de progressão (cargo+salário no cadastro).
-- Aditiva sobre o modelo da Fase 1. Não há org-chart no banco: gate = sócio/administrativo OU people.pdi.write.

-- ---------- Header (colunas do gestor) ----------
ALTER TABLE people.avaliacoes_pdi
  ADD COLUMN IF NOT EXISTS gestor_user_id uuid,
  ADD COLUMN IF NOT EXISTS gestor_nome varchar,
  ADD COLUMN IF NOT EXISTS parecer_gestor text,
  ADD COLUMN IF NOT EXISTS avaliacao_gestor_enviada_at timestamptz,
  ADD COLUMN IF NOT EXISTS cargo_anterior_id uuid,
  ADD COLUMN IF NOT EXISTS salario_anterior numeric,
  ADD COLUMN IF NOT EXISTS novo_cargo_id uuid,
  ADD COLUMN IF NOT EXISTS novo_salario numeric,
  ADD COLUMN IF NOT EXISTS progressao_aplicada_at timestamptz;

-- Metas: validação pelo sócio (faixa_final já existe da Fase 1)
ALTER TABLE people.avaliacoes_pdi_metas_individuais
  ADD COLUMN IF NOT EXISTS validada boolean NOT NULL DEFAULT false;

-- ---------- Helper: quem pode avaliar (gestor/sócio) ----------
CREATE OR REPLACE FUNCTION public.pdi_pode_avaliar()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, core, people AS $fn$
DECLARE v_tenant uuid; v_cat people.colaborador_categoria; v_has boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RETURN false; END IF;
  SELECT categoria INTO v_cat FROM people.colaboradores WHERE user_id=auth.uid() AND tenant_id=v_tenant LIMIT 1;
  IF v_cat IN ('socio','administrativo') THEN RETURN true; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(auth.uid()) k
    WHERE k.permission_key IN ('people.pdi.write','people.*','*')
  ) INTO v_has;
  RETURN COALESCE(v_has,false);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.pdi_pode_avaliar() TO authenticated;

-- ---------- RPC: lista da equipe (avaliações do ano) ----------
CREATE OR REPLACE FUNCTION public.get_equipe_avaliacoes_pdi(p_ano int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;

  RETURN jsonb_build_object(
    'ano', p_ano,
    'itens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.colaborador_nome), '[]'::jsonb) FROM (
        SELECT a.id, a.status, a.faixa_final_geral, a.resultado::text AS resultado,
               a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at, a.progressao_aplicada_at,
               a.cargo_nome_snapshot, a.area_nome_snapshot, a.carreira_codigo, a.adicional_snapshot,
               col.nome AS colaborador_nome, col.categoria::text AS categoria
        FROM people.avaliacoes_pdi a
        JOIN people.colaboradores col ON col.id = a.colaborador_id
        WHERE a.tenant_id = v_tenant AND a.ano = p_ano
      ) x
    )
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_equipe_avaliacoes_pdi(int) TO authenticated;

-- ---------- RPC: avaliação completa p/ o gestor revisar ----------
CREATE OR REPLACE FUNCTION public.get_avaliacao_pdi_gestor(p_avaliacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;
  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'Avaliação não encontrada';
  END IF;

  RETURN jsonb_build_object(
    'avaliacao', (SELECT to_jsonb(x) FROM (
        SELECT a.id, a.ano, a.status, a.bloqueada, a.faixa_final_geral, a.resultado::text AS resultado,
               a.parecer_gestor, a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at,
               a.gestor_nome, a.progressao_aplicada_at, a.novo_salario, a.novo_cargo_id, a.salario_anterior,
               a.bonus_pdi, a.bonus_performance_plus, a.bonus_comercial,
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
    'cargos', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.nivel, c.nome),'[]'::jsonb) FROM (SELECT id, nome, codigo, nivel FROM people.cargos WHERE tenant_id=v_tenant AND ativo IS NOT FALSE) c)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_avaliacao_pdi_gestor(uuid) TO authenticated;

-- ---------- RPC: salvar avaliação do gestor ----------
CREATE OR REPLACE FUNCTION public.salvar_avaliacao_gestor(
  p_avaliacao_id uuid, p_skills jsonb, p_metas jsonb,
  p_faixa_final_geral varchar, p_resultado text, p_parecer text,
  p_bonus_pdi boolean, p_bonus_performance_plus numeric, p_bonus_comercial numeric,
  p_enviar boolean DEFAULT false)
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
    bonus_pdi = COALESCE(p_bonus_pdi, bonus_pdi),
    bonus_performance_plus = p_bonus_performance_plus,
    bonus_comercial = p_bonus_comercial,
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
GRANT EXECUTE ON FUNCTION public.salvar_avaliacao_gestor(uuid,jsonb,jsonb,varchar,text,text,boolean,numeric,numeric,boolean) TO authenticated;

-- ---------- RPC: aplicar progressão (cargo+salário no cadastro) ----------
CREATE OR REPLACE FUNCTION public.aplicar_progressao_pdi(
  p_avaliacao_id uuid, p_novo_cargo_id uuid, p_novo_salario numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid; v_colab uuid; v_cargo_atual uuid; v_sal_atual numeric;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para aplicar progressão'; END IF;

  SELECT colaborador_id INTO v_colab FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF v_colab IS NULL THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;

  IF p_novo_cargo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people.cargos WHERE id=p_novo_cargo_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'Cargo inválido';
  END IF;

  SELECT cargo_id, salario INTO v_cargo_atual, v_sal_atual FROM people.colaboradores WHERE id=v_colab AND tenant_id=v_tenant;

  -- aplica no cadastro
  UPDATE people.colaboradores SET
    cargo_id = COALESCE(p_novo_cargo_id, cargo_id),
    salario = COALESCE(p_novo_salario, salario),
    updated_at = now()
    WHERE id=v_colab AND tenant_id=v_tenant;

  -- registra na avaliação
  UPDATE people.avaliacoes_pdi SET
    cargo_anterior_id = v_cargo_atual,
    salario_anterior = v_sal_atual,
    novo_cargo_id = COALESCE(p_novo_cargo_id, v_cargo_atual),
    novo_salario = COALESCE(p_novo_salario, v_sal_atual),
    progressao_aplicada_at = now(),
    status = 'progressao_aplicada',
    updated_at = now()
    WHERE id=p_avaliacao_id;

  RETURN jsonb_build_object('id', p_avaliacao_id, 'colaborador_id', v_colab,
    'cargo_anterior_id', v_cargo_atual, 'novo_cargo_id', COALESCE(p_novo_cargo_id, v_cargo_atual),
    'salario_anterior', v_sal_atual, 'novo_salario', COALESCE(p_novo_salario, v_sal_atual));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.aplicar_progressao_pdi(uuid,uuid,numeric) TO authenticated;
