-- PDI — ajustes na etapa de autoavaliação (pedido do cliente 26/10/2026,
-- em cima de 20261026120000_pdi_metas_por_periodo.sql).
--
-- 1. O colaborador pode DEVOLVER o próprio período enviado para edição
--    (devolver_minhas_metas_pdi), enquanto o sócio ainda não avaliou aquele
--    período. "Avaliou" = alguma meta do período com faixa do sócio
--    (faixa_final) ou validada, OU a avaliação do gestor concluída depois do
--    envio (avaliacao_gestor_enviada_at >= enviado_em). Ler o aviso na caixa
--    de entrada NÃO conta como avaliação.
--    Ao devolver: o aviso "enviou" pendente é encerrado (lido_at = now(), não
--    apagado — fica o histórico) e os MESMOS destinatários do envio recebem
--    um aviso novo "retirou o envio" (tipo envio_retirado; o link da caixa
--    leva à avaliação da pessoa, como o aviso de envio — listar_caixa_pdi
--    não muda).
-- 2. O 1º semestre de 2026 (autoavaliação de maio, inclusive as 26 que vieram
--    do modelo antigo) vira REGISTRO HISTÓRICO, só leitura para todos:
--    não salva, não anexa, não reabre (nem pelo coordenador/sócio).
--    Regra num lugar só: pdi_periodo_historico(ano, periodo).
-- 3. "Continua valendo": continuar_metas_pdi copia metas de um período para
--    outro (padrão: 2º semestre) no banco, sem duplicar (mesmo nome, ignorando
--    caixa/acentos/espaços) e com a entrega em branco.
-- 4. Avaliação prévia (get_avaliacao_previa_pdi): resumo só leitura do que já
--    está gravado de skills da carreira (faixa auto × gestor) e DNA VLMA
--    (texto/faixa auto) por pessoa, com o mesmo escopo do painel de metas.
--
-- Fonte das funções reescritas: produção (pg_get_functiondef em 26/10/2026),
-- idênticas a 20261026120000 + as mudanças marcadas abaixo.

-- ---------------------------------------------------------------------
-- 1. Tipo novo de aviso
-- ---------------------------------------------------------------------
ALTER TABLE people.pdi_notificacoes DROP CONSTRAINT IF EXISTS pdi_notificacoes_tipo_check;
ALTER TABLE people.pdi_notificacoes ADD CONSTRAINT pdi_notificacoes_tipo_check
  CHECK (tipo IN ('autoavaliacao_enviada', 'periodo_reaberto', 'envio_retirado'));

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------

-- Registro histórico: tudo antes de 2026 e o 1º semestre de 2026 (S1 e os
-- trimestres dele). Espelhada em src/lib/pdi/metas.ts (ehPeriodoHistorico).
CREATE OR REPLACE FUNCTION public.pdi_periodo_historico(p_ano integer, p_periodo text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(p_ano < 2026 OR (p_ano = 2026 AND p_periodo IN ('S1','T1','T2')), false);
$$;

-- O sócio/coordenador já começou a avaliar este período?
CREATE OR REPLACE FUNCTION public.pdi_periodo_avaliado_socio(p_avaliacao_id uuid, p_periodo text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
  SELECT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_individuais m
                  WHERE m.avaliacao_pdi_id = p_avaliacao_id AND m.periodo = p_periodo
                    AND (m.faixa_final IS NOT NULL OR COALESCE(m.validada, false)))
      OR EXISTS (SELECT 1 FROM people.avaliacoes_pdi a
                   JOIN people.avaliacoes_pdi_metas_periodos pe
                     ON pe.avaliacao_pdi_id = a.id AND pe.periodo = p_periodo
                  WHERE a.id = p_avaliacao_id AND pe.enviado_em IS NOT NULL
                    AND a.avaliacao_gestor_enviada_at IS NOT NULL
                    AND a.avaliacao_gestor_enviada_at >= pe.enviado_em);
$$;
REVOKE ALL ON FUNCTION public.pdi_periodo_avaliado_socio(uuid, text) FROM PUBLIC, anon, authenticated;

-- Mesma normalização de normalizarNomeMeta (src/lib/pdi/metas.ts).
CREATE OR REPLACE FUNCTION public.pdi_normalizar_nome_meta(p_nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT lower(btrim(regexp_replace(
           translate(COALESCE(p_nome, ''),
                     'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                     'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'),
           '\s+', ' ', 'g')));
$$;

-- + reaberto_pelo_colaborador, historico, avaliado_socio
CREATE OR REPLACE FUNCTION public.pdi_periodos_json(p_avaliacao_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'periodo', p.periodo, 'enviado_em', p.enviado_em, 'envios', p.envios,
           'reaberto_em', p.reaberto_em,
           'reaberto_pelo_colaborador', (p.reaberto_por IS NOT NULL AND p.reaberto_por = c.user_id),
           'historico', public.pdi_periodo_historico(a.ano, p.periodo),
           'avaliado_socio', public.pdi_periodo_avaliado_socio(p.avaliacao_pdi_id, p.periodo))
           ORDER BY array_position(ARRAY['S1','S2','T1','T2','T3','T4']::varchar[], p.periodo)), '[]'::jsonb)
    FROM people.avaliacoes_pdi_metas_periodos p
    JOIN people.avaliacoes_pdi a ON a.id = p.avaliacao_pdi_id
    LEFT JOIN people.colaboradores c ON c.id = a.colaborador_id
   WHERE p.avaliacao_pdi_id = p_avaliacao_id;
$$;
REVOKE ALL ON FUNCTION public.pdi_periodos_json(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. get_minhas_metas_pdi: + ano
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_minhas_metas_pdi(p_ano integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_aval uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  IF v_colab IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado para este usuário'; END IF;
  SELECT id INTO v_aval FROM people.avaliacoes_pdi
   WHERE tenant_id = v_tenant AND colaborador_id = v_colab AND ano = p_ano LIMIT 1;

  RETURN jsonb_build_object(
    'avaliacao_id', v_aval,
    'tenant_id', v_tenant,
    'ano', p_ano,
    'regua', (SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', f.codigo, 'rotulo', f.rotulo, 'ordem', f.ordem) ORDER BY f.ordem), '[]'::jsonb)
                FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id = v_tenant),
    'periodos', CASE WHEN v_aval IS NULL THEN '[]'::jsonb ELSE public.pdi_periodos_json(v_aval) END,
    'metas', CASE WHEN v_aval IS NULL THEN '[]'::jsonb ELSE public.pdi_metas_json(v_aval) END
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 4. salvar_minhas_metas_pdi: recusa período histórico; mensagem do
--    período enviado aponta para "Voltar para edição".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_minhas_metas_pdi(
  p_avaliacao_id uuid, p_periodo text, p_metas jsonb, p_enviar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE
  v_tenant uuid; v_colab uuid; v_owner uuid; v_ano int; v_colab_nome text;
  v_item jsonb; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_ordem int := 0;
  v_nome text; v_faixa text; v_prog int; v_semestre int;
  v_enviado timestamptz; v_removidos jsonb; v_qtd int; v_pendentes int; v_notif int := 0;
BEGIN
  IF p_periodo IS NULL OR p_periodo NOT IN ('S1','S2','T1','T2','T3','T4') THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id, nome INTO v_colab, v_colab_nome FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  SELECT colaborador_id, ano INTO v_owner, v_ano FROM people.avaliacoes_pdi WHERE id = p_avaliacao_id AND tenant_id = v_tenant;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM v_colab THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;
  IF jsonb_typeof(COALESCE(p_metas, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Metas inválidas'; END IF;

  -- (novo) 1º semestre de 2026 = registro histórico
  IF public.pdi_periodo_historico(v_ano, p_periodo) THEN
    RAISE EXCEPTION 'O % de % é registro histórico (autoavaliação de maio) e não pode mais ser alterado', public.pdi_rotulo_periodo(p_periodo), v_ano;
  END IF;

  SELECT enviado_em INTO v_enviado FROM people.avaliacoes_pdi_metas_periodos
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo;
  IF v_enviado IS NOT NULL THEN
    RAISE EXCEPTION 'A autoavaliação do % já foi enviada — use "Voltar para edição" (ou peça ao seu coordenador para reabrir)', public.pdi_rotulo_periodo(p_periodo);
  END IF;

  v_semestre := CASE WHEN p_periodo IN ('S2','T3','T4') THEN 2 ELSE 1 END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_metas, '[]'::jsonb)) LOOP
    v_ordem := v_ordem + 1;
    v_nome  := NULLIF(btrim(COALESCE(v_item->>'nome', '')), '');
    v_faixa := NULLIF(v_item->>'faixa_auto', '');
    v_prog  := LEAST(100, GREATEST(0, COALESCE(round(NULLIF(v_item->>'progresso_pct', '')::numeric)::int, 0)));
    IF v_faixa IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM people.pdi_faixas_avaliacao WHERE tenant_id = v_tenant AND codigo = v_faixa) THEN
      RAISE EXCEPTION 'Faixa de autoavaliação inválida: %', v_faixa;
    END IF;
    v_id := NULL;
    IF COALESCE(NULLIF(v_item->>'id', ''), '') <> '' THEN
      UPDATE people.avaliacoes_pdi_metas_individuais SET
        nome = v_nome,
        descricao = CASE WHEN v_item ? 'descricao' THEN v_item->>'descricao' ELSE descricao END,
        indicadores = CASE WHEN v_item ? 'indicadores' THEN v_item->>'indicadores' ELSE indicadores END,
        comentario = NULLIF(v_item->>'comentario', ''),
        progresso_pct = v_prog, faixa_auto = v_faixa, ordem = v_ordem, semestre = v_semestre,
        updated_at = now()
       WHERE id = (v_item->>'id')::uuid AND avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'Meta não encontrada neste período'; END IF;
    ELSE
      INSERT INTO people.avaliacoes_pdi_metas_individuais
        (avaliacao_pdi_id, periodo, semestre, nome, descricao, indicadores, comentario, progresso_pct, faixa_auto, ordem)
      VALUES (p_avaliacao_id, p_periodo, v_semestre, v_nome, NULLIF(v_item->>'descricao', ''), NULLIF(v_item->>'indicadores', ''),
              NULLIF(v_item->>'comentario', ''), v_prog, v_faixa, v_ordem)
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  SELECT COALESCE(jsonb_agg(an.storage_path), '[]'::jsonb) INTO v_removidos
    FROM people.avaliacoes_pdi_metas_anexos an
    JOIN people.avaliacoes_pdi_metas_individuais m ON m.id = an.meta_id
   WHERE m.avaliacao_pdi_id = p_avaliacao_id AND m.periodo = p_periodo AND NOT (m.id = ANY(v_ids));
  DELETE FROM people.avaliacoes_pdi_metas_individuais
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo AND NOT (id = ANY(v_ids));

  INSERT INTO people.avaliacoes_pdi_metas_periodos (avaliacao_pdi_id, periodo)
  VALUES (p_avaliacao_id, p_periodo)
  ON CONFLICT (avaliacao_pdi_id, periodo) DO NOTHING;

  IF p_enviar THEN
    SELECT count(*), count(*) FILTER (WHERE nome IS NULL OR faixa_auto IS NULL)
      INTO v_qtd, v_pendentes
      FROM people.avaliacoes_pdi_metas_individuais
     WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo;
    IF v_qtd = 0 THEN RAISE EXCEPTION 'Cadastre ao menos uma meta antes de enviar'; END IF;
    IF v_pendentes > 0 THEN RAISE EXCEPTION 'Toda meta precisa de nome e autoavaliação antes de enviar (% pendente(s))', v_pendentes; END IF;

    UPDATE people.avaliacoes_pdi_metas_periodos
       SET enviado_em = now(), enviado_por = auth.uid(), envios = envios + 1
     WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo;

    UPDATE people.pdi_notificacoes SET lido_at = now()
     WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo
       AND tipo = 'autoavaliacao_enviada' AND lido_at IS NULL;

    INSERT INTO people.pdi_notificacoes (tenant_id, destinatario_user_id, avaliacao_pdi_id, periodo, tipo, titulo)
    SELECT v_tenant, d.user_id, p_avaliacao_id, p_periodo, 'autoavaliacao_enviada',
           format('%s enviou a autoavaliação de metas — %s/%s', COALESCE(v_colab_nome, 'Colaborador'),
                  public.pdi_rotulo_periodo(p_periodo), v_ano)
      FROM public.pdi_destinatarios_metas(v_colab) d;
    GET DIAGNOSTICS v_notif = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('avaliacao_id', p_avaliacao_id, 'periodo', p_periodo, 'enviado', p_enviar,
                            'notificados', v_notif, 'anexos_removidos', v_removidos);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Anexos: período histórico não recebe nem perde anexo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_anexo_meta_pdi(
  p_meta_id uuid, p_arquivo_nome text, p_mime_type text, p_tamanho_bytes bigint, p_storage_path text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_aval uuid; v_owner uuid; v_periodo text; v_id uuid; v_ano int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  SELECT a.id, a.colaborador_id, m.periodo, a.ano INTO v_aval, v_owner, v_periodo, v_ano
    FROM people.avaliacoes_pdi_metas_individuais m
    JOIN people.avaliacoes_pdi a ON a.id = m.avaliacao_pdi_id AND a.tenant_id = v_tenant
   WHERE m.id = p_meta_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM v_colab THEN RAISE EXCEPTION 'Meta não encontrada'; END IF;
  IF public.pdi_periodo_historico(v_ano, v_periodo) THEN
    RAISE EXCEPTION 'Período histórico — não dá para anexar';
  END IF;
  IF EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_periodos
              WHERE avaliacao_pdi_id = v_aval AND periodo = v_periodo AND enviado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Período já enviado — não dá para anexar';
  END IF;
  IF p_storage_path IS NULL OR p_storage_path NOT LIKE (v_tenant::text || '/' || v_aval::text || '/' || p_meta_id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho do anexo inválido';
  END IF;
  IF COALESCE(p_tamanho_bytes, 0) > 26214400 THEN RAISE EXCEPTION 'Anexo maior que 25 MB'; END IF;
  IF (SELECT count(*) FROM people.avaliacoes_pdi_metas_anexos WHERE meta_id = p_meta_id) >= 10 THEN
    RAISE EXCEPTION 'Limite de 10 anexos por meta';
  END IF;

  INSERT INTO people.avaliacoes_pdi_metas_anexos (tenant_id, meta_id, arquivo_nome, mime_type, tamanho_bytes, storage_path, created_by)
  VALUES (v_tenant, p_meta_id, COALESCE(NULLIF(btrim(p_arquivo_nome), ''), 'arquivo'), p_mime_type, p_tamanho_bytes, p_storage_path, auth.uid())
  RETURNING id INTO v_id;

  RETURN (SELECT jsonb_build_object('id', an.id, 'arquivo_nome', an.arquivo_nome, 'mime_type', an.mime_type,
                                    'tamanho_bytes', an.tamanho_bytes, 'storage_path', an.storage_path, 'created_at', an.created_at)
            FROM people.avaliacoes_pdi_metas_anexos an WHERE an.id = v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_anexo_meta_pdi(p_anexo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_aval uuid; v_owner uuid; v_periodo text; v_path text; v_ano int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  SELECT a.id, a.colaborador_id, m.periodo, an.storage_path, a.ano INTO v_aval, v_owner, v_periodo, v_path, v_ano
    FROM people.avaliacoes_pdi_metas_anexos an
    JOIN people.avaliacoes_pdi_metas_individuais m ON m.id = an.meta_id
    JOIN people.avaliacoes_pdi a ON a.id = m.avaliacao_pdi_id AND a.tenant_id = v_tenant
   WHERE an.id = p_anexo_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM v_colab THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  IF public.pdi_periodo_historico(v_ano, v_periodo) THEN
    RAISE EXCEPTION 'Período histórico — não dá para remover o anexo';
  END IF;
  IF EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_periodos
              WHERE avaliacao_pdi_id = v_aval AND periodo = v_periodo AND enviado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Período já enviado — não dá para remover o anexo';
  END IF;
  DELETE FROM people.avaliacoes_pdi_metas_anexos WHERE id = p_anexo_id;
  RETURN jsonb_build_object('id', p_anexo_id, 'storage_path', v_path);
END;
$$;

-- ---------------------------------------------------------------------
-- 6. reabrir_periodo_metas_pdi (coordenador/sócio): + não reabre período
--    histórico.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reabrir_periodo_metas_pdi(p_avaliacao_id uuid, p_periodo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_colab_user uuid; v_ano int; v_nome text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT a.colaborador_id, a.ano, c.user_id INTO v_colab, v_ano, v_colab_user
    FROM people.avaliacoes_pdi a JOIN people.colaboradores c ON c.id = a.colaborador_id
   WHERE a.id = p_avaliacao_id AND a.tenant_id = v_tenant;
  IF v_colab IS NULL THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;
  IF NOT public.pdi_ve_colaborador_na_equipe(v_colab) THEN RAISE EXCEPTION 'Sem permissão para reabrir este período'; END IF;
  IF v_colab_user = auth.uid() THEN RAISE EXCEPTION 'Você não pode reabrir o seu próprio período'; END IF;
  IF public.pdi_periodo_historico(v_ano, p_periodo) THEN
    RAISE EXCEPTION 'O % de % é registro histórico e não pode ser reaberto', public.pdi_rotulo_periodo(p_periodo), v_ano;
  END IF;

  UPDATE people.avaliacoes_pdi_metas_periodos
     SET enviado_em = NULL, reaberto_em = now(), reaberto_por = auth.uid()
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo AND enviado_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este período não está enviado'; END IF;

  UPDATE people.pdi_notificacoes SET lido_at = now()
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo
     AND tipo = 'autoavaliacao_enviada' AND lido_at IS NULL;

  IF v_colab_user IS NOT NULL THEN
    SELECT nome INTO v_nome FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
    INSERT INTO people.pdi_notificacoes (tenant_id, destinatario_user_id, avaliacao_pdi_id, periodo, tipo, titulo)
    VALUES (v_tenant, v_colab_user, p_avaliacao_id, p_periodo, 'periodo_reaberto',
            format('%s reabriu suas metas do %s/%s para edição', COALESCE(v_nome, 'Seu coordenador'),
                   public.pdi_rotulo_periodo(p_periodo), v_ano));
  END IF;

  RETURN jsonb_build_object('avaliacao_id', p_avaliacao_id, 'periodo', p_periodo, 'reaberto', true);
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Colaborador devolve o PRÓPRIO período para edição
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolver_minhas_metas_pdi(p_avaliacao_id uuid, p_periodo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_colab_nome text; v_owner uuid; v_ano int;
        v_enviado timestamptz; v_dest uuid[]; v_notif int := 0;
BEGIN
  IF p_periodo IS NULL OR p_periodo NOT IN ('S1','S2','T1','T2','T3','T4') THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id, nome INTO v_colab, v_colab_nome FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  SELECT colaborador_id, ano INTO v_owner, v_ano FROM people.avaliacoes_pdi WHERE id = p_avaliacao_id AND tenant_id = v_tenant;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM v_colab THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;

  IF public.pdi_periodo_historico(v_ano, p_periodo) THEN
    RAISE EXCEPTION 'O % de % é registro histórico (autoavaliação de maio) e não volta para edição', public.pdi_rotulo_periodo(p_periodo), v_ano;
  END IF;

  SELECT enviado_em INTO v_enviado FROM people.avaliacoes_pdi_metas_periodos
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo
   FOR UPDATE;
  IF v_enviado IS NULL THEN RAISE EXCEPTION 'Este período não está enviado'; END IF;

  IF public.pdi_periodo_avaliado_socio(p_avaliacao_id, p_periodo) THEN
    RAISE EXCEPTION 'O sócio já começou a avaliar o % — para alterar, fale com seu coordenador', public.pdi_rotulo_periodo(p_periodo);
  END IF;

  UPDATE people.avaliacoes_pdi_metas_periodos
     SET enviado_em = NULL, reaberto_em = now(), reaberto_por = auth.uid()
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo;

  -- quem recebeu este envio (avisos criados no envio vigente); se não houver
  -- (envio sem aviso), os destinatários de hoje.
  SELECT array_agg(DISTINCT n.destinatario_user_id) INTO v_dest
    FROM people.pdi_notificacoes n
   WHERE n.avaliacao_pdi_id = p_avaliacao_id AND n.periodo = p_periodo
     AND n.tipo = 'autoavaliacao_enviada' AND n.created_at >= v_enviado;
  IF v_dest IS NULL THEN
    SELECT array_agg(d.user_id) INTO v_dest FROM public.pdi_destinatarios_metas(v_colab) d;
  END IF;

  -- o aviso "enviou" deixa de ser pendência (fica no histórico como lido)
  UPDATE people.pdi_notificacoes SET lido_at = now()
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo
     AND tipo = 'autoavaliacao_enviada' AND lido_at IS NULL;

  IF v_dest IS NOT NULL THEN
    INSERT INTO people.pdi_notificacoes (tenant_id, destinatario_user_id, avaliacao_pdi_id, periodo, tipo, titulo)
    SELECT v_tenant, u, p_avaliacao_id, p_periodo, 'envio_retirado',
           format('%s retirou o envio da autoavaliação de metas — %s/%s (voltou para edição)',
                  COALESCE(v_colab_nome, 'Colaborador'), public.pdi_rotulo_periodo(p_periodo), v_ano)
      FROM unnest(v_dest) u
     WHERE u IS NOT NULL AND u IS DISTINCT FROM auth.uid();
    GET DIAGNOSTICS v_notif = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('avaliacao_id', p_avaliacao_id, 'periodo', p_periodo, 'devolvido', true, 'notificados', v_notif);
END;
$$;

-- ---------------------------------------------------------------------
-- 8. "Continua valendo": copia metas para outro período (padrão S2)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.continuar_metas_pdi(p_meta_ids uuid[], p_periodo_destino text DEFAULT 'S2')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_aval uuid; v_ano int; v_n_aval int; v_m record;
        v_ordem int; v_semestre int; v_copiadas int := 0; v_ja int := 0; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
BEGIN
  IF p_periodo_destino IS NULL OR p_periodo_destino NOT IN ('S1','S2','T1','T2','T3','T4') THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;
  IF p_meta_ids IS NULL OR cardinality(p_meta_ids) = 0 THEN RAISE EXCEPTION 'Nenhuma meta escolhida'; END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;

  -- todas as metas precisam ser do próprio colaborador, na mesma avaliação
  SELECT count(DISTINCT a.id), min(a.id::text)::uuid, min(a.ano) INTO v_n_aval, v_aval, v_ano
    FROM people.avaliacoes_pdi_metas_individuais m
    JOIN people.avaliacoes_pdi a ON a.id = m.avaliacao_pdi_id AND a.tenant_id = v_tenant
   WHERE m.id = ANY(p_meta_ids) AND a.colaborador_id = v_colab;
  IF v_n_aval <> 1 OR (SELECT count(*) FROM people.avaliacoes_pdi_metas_individuais m
                        WHERE m.id = ANY(p_meta_ids) AND m.avaliacao_pdi_id = v_aval) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_meta_ids))) THEN
    RAISE EXCEPTION 'Meta não encontrada';
  END IF;

  IF public.pdi_periodo_historico(v_ano, p_periodo_destino) THEN
    RAISE EXCEPTION 'O % de % é registro histórico', public.pdi_rotulo_periodo(p_periodo_destino), v_ano;
  END IF;
  IF EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_periodos
              WHERE avaliacao_pdi_id = v_aval AND periodo = p_periodo_destino AND enviado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'A autoavaliação do % já foi enviada — volte para edição antes de trazer metas', public.pdi_rotulo_periodo(p_periodo_destino);
  END IF;

  v_semestre := CASE WHEN p_periodo_destino IN ('S2','T3','T4') THEN 2 ELSE 1 END;
  SELECT COALESCE(max(ordem), 0) INTO v_ordem FROM people.avaliacoes_pdi_metas_individuais
   WHERE avaliacao_pdi_id = v_aval AND periodo = p_periodo_destino;

  FOR v_m IN
    SELECT m.* FROM people.avaliacoes_pdi_metas_individuais m
     WHERE m.id = ANY(p_meta_ids) AND m.avaliacao_pdi_id = v_aval
     ORDER BY array_position(ARRAY['S1','S2','T1','T2','T3','T4']::varchar[], m.periodo), m.ordem, m.created_at
  LOOP
    IF public.pdi_normalizar_nome_meta(v_m.nome) = '' OR v_m.periodo = p_periodo_destino
       OR EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_individuais d
                   WHERE d.avaliacao_pdi_id = v_aval AND d.periodo = p_periodo_destino
                     AND public.pdi_normalizar_nome_meta(d.nome) = public.pdi_normalizar_nome_meta(v_m.nome)) THEN
      v_ja := v_ja + 1;
      CONTINUE;
    END IF;
    v_ordem := v_ordem + 1;
    INSERT INTO people.avaliacoes_pdi_metas_individuais
      (avaliacao_pdi_id, periodo, semestre, nome, descricao, indicadores, comentario, progresso_pct, faixa_auto, ordem)
    VALUES (v_aval, p_periodo_destino, v_semestre, btrim(v_m.nome), v_m.descricao, v_m.indicadores, NULL, 0, NULL, v_ordem)
    RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_copiadas := v_copiadas + 1;
  END LOOP;

  INSERT INTO people.avaliacoes_pdi_metas_periodos (avaliacao_pdi_id, periodo)
  VALUES (v_aval, p_periodo_destino)
  ON CONFLICT (avaliacao_pdi_id, periodo) DO NOTHING;

  RETURN jsonb_build_object('avaliacao_id', v_aval, 'periodo', p_periodo_destino,
                            'copiadas', v_copiadas, 'ja_existiam', v_ja, 'ids', to_jsonb(v_ids));
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Avaliação prévia — skills da carreira e DNA VLMA já gravados.
--     Escopo idêntico a get_painel_metas_pdi: quem não avalia vê só o
--     próprio; sócio/adm VLMA veem todos; coordenador, a própria área.
--     Linhas cruas; o resumo por pilar é feito em resumirAvaliacaoPrevia.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_avaliacao_previa_pdi(p_ano integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_cat people.colaborador_categoria; v_area uuid; v_area_nome text; v_escopo text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT col.id, col.categoria, col.area_id, a.nome INTO v_colab, v_cat, v_area, v_area_nome
    FROM people.colaboradores col
    LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
   WHERE col.user_id = auth.uid() AND col.tenant_id = v_tenant LIMIT 1;

  v_escopo := CASE
    WHEN NOT public.pdi_pode_avaliar() THEN 'proprio'
    WHEN v_cat = 'socio' OR (v_cat = 'administrativo' AND v_area_nome = 'VLMA') THEN 'todos'
    ELSE 'area' END;
  IF v_escopo = 'proprio' AND v_colab IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado para este usuário'; END IF;

  RETURN (
    WITH avs AS (
      SELECT a.id AS avaliacao_id, col.id AS colaborador_id, col.nome,
             a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at, a.gestor_nome
        FROM people.avaliacoes_pdi a
        JOIN people.colaboradores col ON col.id = a.colaborador_id AND col.tenant_id = v_tenant
       WHERE a.tenant_id = v_tenant AND a.ano = p_ano
         AND CASE v_escopo
               WHEN 'todos' THEN true
               WHEN 'area' THEN col.area_id = v_area
               ELSE col.id = v_colab END
    ),
    sk AS (
      SELECT s.* FROM people.avaliacoes_pdi_skills_carreira s JOIN avs ON avs.avaliacao_id = s.avaliacao_pdi_id
       WHERE s.faixa_auto IS NOT NULL OR s.faixa_final IS NOT NULL
    ),
    dn AS (
      SELECT d.* FROM people.avaliacoes_pdi_dna_vlma d JOIN avs ON avs.avaliacao_id = d.avaliacao_pdi_id
       WHERE d.faixa_auto IS NOT NULL OR NULLIF(btrim(d.texto_auto), '') IS NOT NULL
    )
    SELECT jsonb_build_object(
      'ano', p_ano,
      'escopo', v_escopo,
      'pessoas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'colaborador_id', avs.colaborador_id, 'nome', avs.nome, 'avaliacao_id', avs.avaliacao_id,
          'autoavaliacao_enviada_at', avs.autoavaliacao_enviada_at,
          'avaliacao_gestor_enviada_at', avs.avaliacao_gestor_enviada_at, 'gestor_nome', avs.gestor_nome,
          'skills', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'trilha', sk.trilha, 'pilar_numero', sk.pilar_numero, 'pilar_nome', sk.pilar_nome,
                        'item_codigo', sk.item_codigo, 'faixa_auto', sk.faixa_auto, 'faixa_gestor', sk.faixa_final)
                        ORDER BY CASE sk.trilha WHEN 'base' THEN 0 ELSE 1 END, sk.trilha, sk.pilar_numero, sk.item_codigo), '[]'::jsonb)
                       FROM sk WHERE sk.avaliacao_pdi_id = avs.avaliacao_id),
          'dna', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'numero', dn.numero, 'nome', dn.nome, 'faixa_auto', dn.faixa_auto, 'texto_auto', dn.texto_auto)
                     ORDER BY dn.numero), '[]'::jsonb)
                    FROM dn WHERE dn.avaliacao_pdi_id = avs.avaliacao_id))
          ORDER BY avs.nome), '[]'::jsonb)
        FROM avs
       WHERE EXISTS (SELECT 1 FROM sk WHERE sk.avaliacao_pdi_id = avs.avaliacao_id)
          OR EXISTS (SELECT 1 FROM dn WHERE dn.avaliacao_pdi_id = avs.avaliacao_id))
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.devolver_minhas_metas_pdi(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.continuar_metas_pdi(uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_avaliacao_previa_pdi(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pdi_periodo_historico(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pdi_normalizar_nome_meta(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.devolver_minhas_metas_pdi(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.continuar_metas_pdi(uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_avaliacao_previa_pdi(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pdi_periodo_historico(integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pdi_normalizar_nome_meta(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pdi_periodo_avaliado_socio(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
