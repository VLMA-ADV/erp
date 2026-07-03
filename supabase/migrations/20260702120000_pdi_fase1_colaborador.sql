-- PDI Fase 1 — jornada do colaborador. Evolui o esqueleto antigo (tabelas vazias) para o modelo de faixas.

-- Header
ALTER TABLE people.avaliacoes_pdi
  ADD COLUMN IF NOT EXISTS cargo_id_snapshot uuid,
  ADD COLUMN IF NOT EXISTS cargo_nome_snapshot varchar,
  ADD COLUMN IF NOT EXISTS nivel_codigo_snapshot varchar,
  ADD COLUMN IF NOT EXISTS carreira_codigo varchar,
  ADD COLUMN IF NOT EXISTS adicional_snapshot varchar,
  ADD COLUMN IF NOT EXISTS area_nome_snapshot varchar,
  ADD COLUMN IF NOT EXISTS faixa_final_geral varchar,
  ADD COLUMN IF NOT EXISTS autoavaliacao_enviada_at timestamptz,
  ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS bloqueada boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_avaliacoes_pdi_colab_ano ON people.avaliacoes_pdi (tenant_id, colaborador_id, ano);

-- Modelo antigo era 1:1 (uma linha por avaliação, nota NOT NULL). Novo é N itens por faixa.
ALTER TABLE people.avaliacoes_pdi_dna_vlma DROP CONSTRAINT IF EXISTS avaliacoes_pdi_dna_vlma_avaliacao_pdi_id_key;
DROP INDEX IF EXISTS people.idx_avaliacoes_pdi_dna_avaliacao;
ALTER TABLE people.avaliacoes_pdi_skills_carreira ALTER COLUMN nota DROP NOT NULL;
ALTER TABLE people.avaliacoes_pdi_dna_vlma ALTER COLUMN nota DROP NOT NULL;
ALTER TABLE people.avaliacoes_pdi_metas_individuais ALTER COLUMN nota DROP NOT NULL;

-- DNA
ALTER TABLE people.avaliacoes_pdi_dna_vlma
  ADD COLUMN IF NOT EXISTS numero int,
  ADD COLUMN IF NOT EXISTS faixa_auto varchar,
  ADD COLUMN IF NOT EXISTS texto_auto text,
  ADD COLUMN IF NOT EXISTS ordem int;

-- Skills
ALTER TABLE people.avaliacoes_pdi_skills_carreira
  ADD COLUMN IF NOT EXISTS trilha varchar,
  ADD COLUMN IF NOT EXISTS pilar_numero int,
  ADD COLUMN IF NOT EXISTS pilar_nome varchar,
  ADD COLUMN IF NOT EXISTS item_codigo varchar,
  ADD COLUMN IF NOT EXISTS titulo varchar,
  ADD COLUMN IF NOT EXISTS faixa_auto varchar,
  ADD COLUMN IF NOT EXISTS faixa_final varchar,
  ADD COLUMN IF NOT EXISTS texto_auto text,
  ADD COLUMN IF NOT EXISTS texto_final text;

-- Metas
ALTER TABLE people.avaliacoes_pdi_metas_individuais
  ADD COLUMN IF NOT EXISTS semestre int,
  ADD COLUMN IF NOT EXISTS indicadores text,
  ADD COLUMN IF NOT EXISTS progresso_pct int,
  ADD COLUMN IF NOT EXISTS faixa_auto varchar,
  ADD COLUMN IF NOT EXISTS faixa_final varchar;

-- Feedbacks mensais
CREATE TABLE IF NOT EXISTS people.avaliacoes_pdi_feedbacks_mensais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_pdi_id uuid NOT NULL REFERENCES people.avaliacoes_pdi(id) ON DELETE CASCADE,
  mes int NOT NULL,
  realizado boolean NOT NULL DEFAULT false,
  funcionou text, nao_funcionou text, onde_focar text, persiste text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (avaliacao_pdi_id, mes)
);

-- ============ RPC: get_minha_avaliacao_pdi (monta do catálogo se novo) ============
CREATE OR REPLACE FUNCTION public.get_minha_avaliacao_pdi(p_ano int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE
  v_tenant uuid; v_colab uuid; v_cargo_id uuid; v_cargo_nome varchar; v_nivel varchar;
  v_adicional varchar; v_area varchar; v_carreira varchar; v_aval uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT c.id, c.cargo_id, ca.nome, ca.codigo, c.adicional::varchar, a.nome
    INTO v_colab, v_cargo_id, v_cargo_nome, v_nivel, v_adicional, v_area
  FROM people.colaboradores c
  LEFT JOIN people.cargos ca ON ca.id=c.cargo_id
  LEFT JOIN people.areas a ON a.id=c.area_id
  WHERE c.user_id = auth.uid() AND c.tenant_id=v_tenant LIMIT 1;
  IF v_colab IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado para este usuário'; END IF;

  -- mapeia código do cargo para nível
  v_nivel := CASE
    WHEN v_nivel ~* '^ESTAG' THEN 'ESTAGIARIO'
    WHEN v_nivel ~* '^JR[0-9]' OR v_nivel ~* '^JUNIOR' THEN 'JUNIOR'
    WHEN v_nivel ~* '^PL' THEN 'PLENO'
    WHEN v_nivel ~* '^SR' OR v_nivel ~* '^SENIOR' THEN 'SENIOR'
    ELSE 'SENIOR' END;
  v_carreira := CASE WHEN v_area ILIKE 'Contencioso' THEN 'CONTENCIOSO' ELSE 'CONSULTORIA' END;

  -- acha ou cria a avaliação do ano
  SELECT id INTO v_aval FROM people.avaliacoes_pdi WHERE tenant_id=v_tenant AND colaborador_id=v_colab AND ano=p_ano LIMIT 1;
  IF v_aval IS NULL THEN
    INSERT INTO people.avaliacoes_pdi (tenant_id, ano, tipo, colaborador_id, status,
      cargo_id_snapshot, cargo_nome_snapshot, nivel_codigo_snapshot, carreira_codigo, adicional_snapshot, area_nome_snapshot, created_by)
    VALUES (v_tenant, p_ano, 'definitiva', v_colab, 'rascunho',
      v_cargo_id, v_cargo_nome, v_nivel, v_carreira, v_adicional, v_area, auth.uid())
    RETURNING id INTO v_aval;
  END IF;

  -- monta SKILLS do catálogo (se ainda vazio)
  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_skills_carreira WHERE avaliacao_pdi_id=v_aval) THEN
    INSERT INTO people.avaliacoes_pdi_skills_carreira
      (avaliacao_pdi_id, trilha, pilar_numero, pilar_nome, item_codigo, titulo, nome, descricao, ordem)
    SELECT v_aval, s.trilha, s.pilar_numero, p.nome, s.item_codigo, s.titulo,
           COALESCE(NULLIF(s.titulo,''),p.nome), s.descricao, s.ordem
    FROM people.pdi_skills_catalogo s
    JOIN people.pdi_pilares p ON p.tenant_id=s.tenant_id AND p.trilha=s.trilha AND p.numero=s.pilar_numero
    WHERE s.tenant_id=v_tenant
      AND ( (s.trilha='base' AND s.nivel_codigo=v_nivel)
            OR (v_adicional IS NOT NULL AND s.trilha=v_adicional AND s.nivel_codigo='TODOS') );
  END IF;

  -- monta DNA (se vazio)
  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_dna_vlma WHERE avaliacao_pdi_id=v_aval) THEN
    INSERT INTO people.avaliacoes_pdi_dna_vlma (avaliacao_pdi_id, numero, nome, ordem)
    SELECT v_aval, d.numero, d.nome, d.numero FROM people.pdi_dna_itens d WHERE d.tenant_id=v_tenant;
  END IF;

  -- feedbacks mensais (12 meses, se vazio)
  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_feedbacks_mensais WHERE avaliacao_pdi_id=v_aval) THEN
    INSERT INTO people.avaliacoes_pdi_feedbacks_mensais (avaliacao_pdi_id, mes)
    SELECT v_aval, g FROM generate_series(1,12) g;
  END IF;

  RETURN jsonb_build_object(
    'avaliacao', (SELECT to_jsonb(x) FROM (
        SELECT a.id, a.ano, a.status, a.bloqueada, a.faixa_final_geral, a.autoavaliacao_enviada_at,
               a.cargo_nome_snapshot, a.nivel_codigo_snapshot, a.carreira_codigo, a.adicional_snapshot, a.area_nome_snapshot,
               (SELECT nome FROM people.colaboradores WHERE id=a.colaborador_id) AS colaborador_nome
        FROM people.avaliacoes_pdi a WHERE a.id=v_aval) x),
    'regua', (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id=v_tenant),
    'skills', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.trilha, s.pilar_numero, s.item_codigo),'[]'::jsonb) FROM people.avaliacoes_pdi_skills_carreira s WHERE s.avaliacao_pdi_id=v_aval),
    'dna', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.numero),'[]'::jsonb) FROM people.avaliacoes_pdi_dna_vlma d WHERE d.avaliacao_pdi_id=v_aval),
    'metas', (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.semestre, m.ordem, m.created_at),'[]'::jsonb) FROM people.avaliacoes_pdi_metas_individuais m WHERE m.avaliacao_pdi_id=v_aval),
    'feedbacks', (SELECT COALESCE(jsonb_agg(to_jsonb(fb) ORDER BY fb.mes),'[]'::jsonb) FROM people.avaliacoes_pdi_feedbacks_mensais fb WHERE fb.avaliacao_pdi_id=v_aval)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_minha_avaliacao_pdi(int) TO authenticated;

-- ============ RPC: salvar_minha_avaliacao_pdi ============
CREATE OR REPLACE FUNCTION public.salvar_minha_avaliacao_pdi(
  p_avaliacao_id uuid, p_skills jsonb, p_dna jsonb, p_metas jsonb, p_feedbacks jsonb, p_enviar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid; v_colab uuid; v_owner uuid; v_bloq boolean; v_item jsonb; v_meta_ids uuid[];
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id=auth.uid() AND tenant_id=v_tenant LIMIT 1;
  SELECT colaborador_id, bloqueada INTO v_owner, v_bloq FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF v_owner IS NULL OR v_owner <> v_colab THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;
  IF v_bloq THEN RAISE EXCEPTION 'Avaliação já enviada e bloqueada para edição'; END IF;

  -- skills (autoavaliação)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_skills,'[]'::jsonb)) LOOP
    UPDATE people.avaliacoes_pdi_skills_carreira
      SET faixa_auto=NULLIF(v_item->>'faixa_auto',''), texto_auto=v_item->>'texto_auto', updated_at=now()
      WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
  END LOOP;

  -- dna
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_dna,'[]'::jsonb)) LOOP
    UPDATE people.avaliacoes_pdi_dna_vlma
      SET faixa_auto=NULLIF(v_item->>'faixa_auto',''), texto_auto=v_item->>'texto_auto', updated_at=now()
      WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
  END LOOP;

  -- feedbacks
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_feedbacks,'[]'::jsonb)) LOOP
    UPDATE people.avaliacoes_pdi_feedbacks_mensais
      SET realizado=COALESCE((v_item->>'realizado')::boolean,false),
          funcionou=v_item->>'funcionou', nao_funcionou=v_item->>'nao_funcionou',
          onde_focar=v_item->>'onde_focar', persiste=v_item->>'persiste', updated_at=now()
      WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
  END LOOP;

  -- metas: upsert + remove ausentes
  v_meta_ids := ARRAY[]::uuid[];
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_metas,'[]'::jsonb)) LOOP
    IF COALESCE(NULLIF(v_item->>'id',''),'') <> '' THEN
      UPDATE people.avaliacoes_pdi_metas_individuais SET
        nome=v_item->>'nome', descricao=v_item->>'descricao', indicadores=v_item->>'indicadores',
        semestre=NULLIF(v_item->>'semestre','')::int, progresso_pct=NULLIF(v_item->>'progresso_pct','')::int, updated_at=now()
        WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
      v_meta_ids := array_append(v_meta_ids, (v_item->>'id')::uuid);
    ELSE
      INSERT INTO people.avaliacoes_pdi_metas_individuais (avaliacao_pdi_id, nome, descricao, indicadores, semestre, progresso_pct, ordem)
      VALUES (p_avaliacao_id, v_item->>'nome', v_item->>'descricao', v_item->>'indicadores',
        NULLIF(v_item->>'semestre','')::int, NULLIF(v_item->>'progresso_pct','')::int, 0)
      RETURNING id INTO v_owner; -- reuse var
      v_meta_ids := array_append(v_meta_ids, v_owner);
    END IF;
  END LOOP;
  DELETE FROM people.avaliacoes_pdi_metas_individuais WHERE avaliacao_pdi_id=p_avaliacao_id AND NOT (id = ANY(v_meta_ids));

  UPDATE people.avaliacoes_pdi SET updated_at=now(),
    status = CASE WHEN p_enviar THEN 'autoavaliacao_enviada' ELSE status END,
    autoavaliacao_enviada_at = CASE WHEN p_enviar THEN now() ELSE autoavaliacao_enviada_at END,
    bloqueada = CASE WHEN p_enviar THEN true ELSE bloqueada END
    WHERE id=p_avaliacao_id;

  RETURN jsonb_build_object('id', p_avaliacao_id, 'enviada', p_enviar);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.salvar_minha_avaliacao_pdi(uuid,jsonb,jsonb,jsonb,jsonb,boolean) TO authenticated;
