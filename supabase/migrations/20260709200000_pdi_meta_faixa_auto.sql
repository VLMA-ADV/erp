-- PDI: gravar a avaliação (faixa) de cada meta na autoavaliação.
-- A coluna faixa_auto já existe em avaliacoes_pdi_metas_individuais;
-- salvar_minha_avaliacao_pdi passa a persisti-la no upsert de metas.

CREATE OR REPLACE FUNCTION public.salvar_minha_avaliacao_pdi(p_avaliacao_id uuid, p_skills jsonb, p_dna jsonb, p_metas jsonb, p_feedbacks jsonb, p_enviar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
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
        semestre=NULLIF(v_item->>'semestre','')::int, progresso_pct=NULLIF(v_item->>'progresso_pct','')::int,
        faixa_auto=NULLIF(v_item->>'faixa_auto',''), updated_at=now()
        WHERE id=(v_item->>'id')::uuid AND avaliacao_pdi_id=p_avaliacao_id;
      v_meta_ids := array_append(v_meta_ids, (v_item->>'id')::uuid);
    ELSE
      INSERT INTO people.avaliacoes_pdi_metas_individuais (avaliacao_pdi_id, nome, descricao, indicadores, semestre, progresso_pct, faixa_auto, ordem)
      VALUES (p_avaliacao_id, v_item->>'nome', v_item->>'descricao', v_item->>'indicadores',
        NULLIF(v_item->>'semestre','')::int, NULLIF(v_item->>'progresso_pct','')::int, NULLIF(v_item->>'faixa_auto',''), 0)
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
$function$
;

NOTIFY pgrst, 'reload schema';
