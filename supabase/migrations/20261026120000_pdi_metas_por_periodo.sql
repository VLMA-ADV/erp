-- PDI — metas por período com autoavaliação, envio e caixa do coordenador
-- (pedido do cliente 26/10/2026).
--
-- Jornada: o colaborador abre "Meu PDI", lança as metas de um período
-- (1º/2º semestre ou 1º–4º trimestre), dá a autoavaliação (régua de 5 faixas),
-- o progresso (0–100%), um comentário e anexa evidências. Ao clicar "Enviar
-- autoavaliação" o período trava para ele e cai na caixa de entrada do
-- coordenador da área, que em janeiro continua a avaliação (faixa do sócio).
--
-- MODELO: estende people.avaliacoes_pdi_metas_individuais em vez de criar
-- tabela nova. A meta já tinha progresso_pct, faixa_auto (autoavaliação),
-- faixa_final (avaliação do sócio/gestor) e validada, e é lida pela revisão do
-- gestor e pela consolidação. Estender preserva as 93 metas que existem em
-- produção sem mover dado nenhum. O que falta entra aqui:
--   * metas.periodo (S1, S2, T1–T4) — preenchido a partir de metas.semestre;
--   * metas.comentario;
--   * avaliacoes_pdi_metas_periodos — o envio é POR PERÍODO (enviado_em trava
--     a edição; reaberto_em/por registram quando o coordenador reabre);
--   * avaliacoes_pdi_metas_anexos + bucket privado pdi-metas-anexos;
--   * pdi_notificacoes — o que alimenta a aba "PDI" da caixa de entrada que
--     já existe (o botão laranja do layout), no mesmo molde de lido_at das
--     solicitações de contrato.
--
-- Avaliação já enviada no modelo antigo (autoavaliacao_enviada_at preenchido)
-- conta como 1º semestre ENVIADO; o 2º semestre fica aberto para a
-- autoavaliação de agora. Nenhuma notificação é gerada para esse histórico.
--
-- Tudo é acessado só por RPC SECURITY DEFINER (authenticated não tem USAGE no
-- schema people). A trava do envio inteiro (avaliacoes_pdi.bloqueada) segue
-- valendo para skills, DNA e feedbacks, mas deixa de mexer nas metas.

-- ---------------------------------------------------------------------
-- 1. Colunas novas na meta
-- ---------------------------------------------------------------------
ALTER TABLE people.avaliacoes_pdi_metas_individuais
  ADD COLUMN IF NOT EXISTS periodo varchar(2),
  ADD COLUMN IF NOT EXISTS comentario text;

UPDATE people.avaliacoes_pdi_metas_individuais
   SET periodo = CASE WHEN semestre = 2 THEN 'S2' ELSE 'S1' END
 WHERE periodo IS NULL;

ALTER TABLE people.avaliacoes_pdi_metas_individuais
  ALTER COLUMN periodo SET DEFAULT 'S1',
  ALTER COLUMN periodo SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'avaliacoes_pdi_metas_periodo_check') THEN
    ALTER TABLE people.avaliacoes_pdi_metas_individuais
      ADD CONSTRAINT avaliacoes_pdi_metas_periodo_check
      CHECK (periodo IN ('S1','S2','T1','T2','T3','T4'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'avaliacoes_pdi_metas_progresso_check') THEN
    ALTER TABLE people.avaliacoes_pdi_metas_individuais
      ADD CONSTRAINT avaliacoes_pdi_metas_progresso_check
      CHECK (progresso_pct IS NULL OR progresso_pct BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_avaliacoes_pdi_metas_aval_periodo
  ON people.avaliacoes_pdi_metas_individuais (avaliacao_pdi_id, periodo);

-- ---------------------------------------------------------------------
-- 2. Envio por período
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people.avaliacoes_pdi_metas_periodos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_pdi_id uuid NOT NULL REFERENCES people.avaliacoes_pdi(id) ON DELETE CASCADE,
  periodo          varchar(2) NOT NULL CHECK (periodo IN ('S1','S2','T1','T2','T3','T4')),
  enviado_em       timestamptz,          -- preenchido = travado para o colaborador
  enviado_por      uuid,
  envios           integer NOT NULL DEFAULT 0,
  reaberto_em      timestamptz,
  reaberto_por     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (avaliacao_pdi_id, periodo)
);

INSERT INTO people.avaliacoes_pdi_metas_periodos (avaliacao_pdi_id, periodo, enviado_em, enviado_por, envios)
SELECT a.id, 'S1', a.autoavaliacao_enviada_at, a.created_by, 1
  FROM people.avaliacoes_pdi a
 WHERE a.autoavaliacao_enviada_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_individuais m
                WHERE m.avaliacao_pdi_id = a.id AND m.periodo = 'S1')
ON CONFLICT (avaliacao_pdi_id, periodo) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Anexos da meta (arquivo no bucket pdi-metas-anexos,
--    path <tenant_id>/<avaliacao_id>/<meta_id>/<ts>-<nome>)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people.avaliacoes_pdi_metas_anexos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  meta_id        uuid NOT NULL REFERENCES people.avaliacoes_pdi_metas_individuais(id) ON DELETE CASCADE,
  arquivo_nome   text NOT NULL,
  mime_type      text,
  tamanho_bytes  bigint,
  storage_path   text NOT NULL UNIQUE,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_pdi_metas_anexos_meta
  ON people.avaliacoes_pdi_metas_anexos (meta_id);

-- ---------------------------------------------------------------------
-- 4. Notificações da caixa de entrada (aba PDI)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people.pdi_notificacoes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  destinatario_user_id uuid NOT NULL,
  avaliacao_pdi_id     uuid NOT NULL REFERENCES people.avaliacoes_pdi(id) ON DELETE CASCADE,
  periodo              varchar(2) NOT NULL,
  tipo                 varchar(32) NOT NULL CHECK (tipo IN ('autoavaliacao_enviada','periodo_reaberto')),
  titulo               text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  lido_at              timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pdi_notificacoes_dest
  ON people.pdi_notificacoes (destinatario_user_id, lido_at, created_at DESC);

-- RLS: o client nunca lê direto (sem USAGE em people); só service_role.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  people.avaliacoes_pdi_metas_periodos, people.avaliacoes_pdi_metas_anexos, people.pdi_notificacoes
  TO service_role;
ALTER TABLE people.avaliacoes_pdi_metas_periodos ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.avaliacoes_pdi_metas_anexos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.pdi_notificacoes              ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='people' AND policyname='service_role_all_pdi_metas_periodos') THEN
    CREATE POLICY service_role_all_pdi_metas_periodos ON people.avaliacoes_pdi_metas_periodos FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='people' AND policyname='service_role_all_pdi_metas_anexos') THEN
    CREATE POLICY service_role_all_pdi_metas_anexos ON people.avaliacoes_pdi_metas_anexos FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='people' AND policyname='service_role_all_pdi_notificacoes') THEN
    CREATE POLICY service_role_all_pdi_notificacoes ON people.pdi_notificacoes FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_avaliacoes_pdi_metas_periodos_updated_at ON people.avaliacoes_pdi_metas_periodos;
CREATE TRIGGER update_avaliacoes_pdi_metas_periodos_updated_at
  BEFORE UPDATE ON people.avaliacoes_pdi_metas_periodos
  FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 5. Visão consultável para a progressão de carreira (cálculo fica para
--    depois): meta × período × faixa × progresso × enviado_em.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW people.vw_pdi_metas_autoavaliacao WITH (security_invoker = true) AS
SELECT a.tenant_id, a.ano, a.id AS avaliacao_pdi_id, a.colaborador_id,
       col.nome AS colaborador_nome, col.area_id, ar.nome AS area_nome,
       m.id AS meta_id, m.periodo, m.nome AS meta_nome,
       m.faixa_auto, m.faixa_final AS faixa_socio, m.progresso_pct, m.comentario, m.validada,
       p.enviado_em AS periodo_enviado_em,
       (SELECT count(*) FROM people.avaliacoes_pdi_metas_anexos an WHERE an.meta_id = m.id)::int AS qtd_anexos,
       m.updated_at
  FROM people.avaliacoes_pdi_metas_individuais m
  JOIN people.avaliacoes_pdi a ON a.id = m.avaliacao_pdi_id
  JOIN people.colaboradores col ON col.id = a.colaborador_id
  LEFT JOIN people.areas ar ON ar.id = col.area_id
  LEFT JOIN people.avaliacoes_pdi_metas_periodos p ON p.avaliacao_pdi_id = a.id AND p.periodo = m.periodo;
REVOKE ALL ON people.vw_pdi_metas_autoavaliacao FROM PUBLIC;
GRANT SELECT ON people.vw_pdi_metas_autoavaliacao TO service_role;

-- ---------------------------------------------------------------------
-- 6. Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pdi_rotulo_periodo(p_periodo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_periodo
    WHEN 'S1' THEN '1º semestre' WHEN 'S2' THEN '2º semestre'
    WHEN 'T1' THEN '1º trimestre' WHEN 'T2' THEN '2º trimestre'
    WHEN 'T3' THEN '3º trimestre' WHEN 'T4' THEN '4º trimestre'
    ELSE p_periodo END;
$$;

-- Mesma regra de get_equipe_avaliacoes_pdi: quem pode avaliar (sócio,
-- administrativo do CC VLMA ou coordenador) e, se não for sócio/adm VLMA,
-- só a própria área.
CREATE OR REPLACE FUNCTION public.pdi_ve_colaborador_na_equipe(p_colaborador_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_cat people.colaborador_categoria; v_area uuid; v_area_nome text;
        v_alvo_area uuid; v_alvo_tenant uuid;
BEGIN
  IF auth.uid() IS NULL OR p_colaborador_id IS NULL THEN RETURN false; END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL OR NOT public.pdi_pode_avaliar() THEN RETURN false; END IF;

  SELECT area_id, tenant_id INTO v_alvo_area, v_alvo_tenant FROM people.colaboradores WHERE id = p_colaborador_id;
  IF v_alvo_tenant IS DISTINCT FROM v_tenant THEN RETURN false; END IF;

  SELECT col.categoria, col.area_id, a.nome INTO v_cat, v_area, v_area_nome
    FROM people.colaboradores col
    LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
   WHERE col.user_id = auth.uid() AND col.tenant_id = v_tenant LIMIT 1;

  IF v_cat = 'socio' OR (v_cat = 'administrativo' AND v_area_nome = 'VLMA') THEN RETURN true; END IF;
  RETURN v_area IS NOT NULL AND v_area = v_alvo_area;
END;
$$;

-- Quem recebe o envio: coordenadores ativos (com login) da área do
-- colaborador, exceto ele mesmo. Área sem coordenador → sócios ativos.
CREATE OR REPLACE FUNCTION public.pdi_destinatarios_metas(p_colaborador_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
#variable_conflict use_column
DECLARE v_tenant uuid; v_area uuid; v_self uuid;
BEGIN
  SELECT c.tenant_id, c.area_id, c.user_id INTO v_tenant, v_area, v_self
    FROM people.colaboradores c WHERE c.id = p_colaborador_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT DISTINCT c.user_id FROM people.colaboradores c
      JOIN core.tenant_users tu ON tu.user_id = c.user_id AND tu.tenant_id = c.tenant_id AND tu.status = 'ativo'
     WHERE c.tenant_id = v_tenant AND c.ativo AND COALESCE(c.eh_coordenador, false)
       AND v_area IS NOT NULL AND c.area_id = v_area
       AND c.user_id IS NOT NULL AND c.user_id IS DISTINCT FROM v_self;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT DISTINCT c.user_id FROM people.colaboradores c
      JOIN core.tenant_users tu ON tu.user_id = c.user_id AND tu.tenant_id = c.tenant_id AND tu.status = 'ativo'
     WHERE c.tenant_id = v_tenant AND c.ativo AND c.categoria = 'socio'
       AND c.user_id IS NOT NULL AND c.user_id IS DISTINCT FROM v_self;
END;
$$;
REVOKE ALL ON FUNCTION public.pdi_destinatarios_metas(uuid) FROM PUBLIC, anon, authenticated;

-- JSON das metas de uma avaliação (com anexos), em ordem de período.
CREATE OR REPLACE FUNCTION public.pdi_metas_json(p_avaliacao_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
  SELECT COALESCE(jsonb_agg(
           to_jsonb(m) || jsonb_build_object('anexos', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', an.id, 'arquivo_nome', an.arquivo_nome, 'mime_type', an.mime_type,
                      'tamanho_bytes', an.tamanho_bytes, 'storage_path', an.storage_path,
                      'created_at', an.created_at) ORDER BY an.created_at), '[]'::jsonb)
               FROM people.avaliacoes_pdi_metas_anexos an WHERE an.meta_id = m.id))
           ORDER BY array_position(ARRAY['S1','S2','T1','T2','T3','T4']::varchar[], m.periodo), m.ordem, m.created_at),
         '[]'::jsonb)
    FROM people.avaliacoes_pdi_metas_individuais m
   WHERE m.avaliacao_pdi_id = p_avaliacao_id;
$$;
REVOKE ALL ON FUNCTION public.pdi_metas_json(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pdi_periodos_json(p_avaliacao_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'periodo', p.periodo, 'enviado_em', p.enviado_em, 'envios', p.envios,
           'reaberto_em', p.reaberto_em)
           ORDER BY array_position(ARRAY['S1','S2','T1','T2','T3','T4']::varchar[], p.periodo)), '[]'::jsonb)
    FROM people.avaliacoes_pdi_metas_periodos p
   WHERE p.avaliacao_pdi_id = p_avaliacao_id;
$$;
REVOKE ALL ON FUNCTION public.pdi_periodos_json(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Colaborador: ler e salvar as próprias metas por período
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
    'regua', (SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', f.codigo, 'rotulo', f.rotulo, 'ordem', f.ordem) ORDER BY f.ordem), '[]'::jsonb)
                FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id = v_tenant),
    'periodos', CASE WHEN v_aval IS NULL THEN '[]'::jsonb ELSE public.pdi_periodos_json(v_aval) END,
    'metas', CASE WHEN v_aval IS NULL THEN '[]'::jsonb ELSE public.pdi_metas_json(v_aval) END
  );
END;
$$;

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

  SELECT enviado_em INTO v_enviado FROM people.avaliacoes_pdi_metas_periodos
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo;
  IF v_enviado IS NOT NULL THEN
    RAISE EXCEPTION 'A autoavaliação do % já foi enviada — peça ao seu coordenador para reabrir', public.pdi_rotulo_periodo(p_periodo);
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

  -- metas que saíram da tela: devolve os paths dos anexos para o front
  -- apagar do bucket (as linhas de anexo caem em cascata).
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

    -- um envio novo substitui aviso antigo ainda não lido do mesmo período
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

CREATE OR REPLACE FUNCTION public.registrar_anexo_meta_pdi(
  p_meta_id uuid, p_arquivo_nome text, p_mime_type text, p_tamanho_bytes bigint, p_storage_path text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_tenant uuid; v_colab uuid; v_aval uuid; v_owner uuid; v_periodo text; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  SELECT a.id, a.colaborador_id, m.periodo INTO v_aval, v_owner, v_periodo
    FROM people.avaliacoes_pdi_metas_individuais m
    JOIN people.avaliacoes_pdi a ON a.id = m.avaliacao_pdi_id AND a.tenant_id = v_tenant
   WHERE m.id = p_meta_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM v_colab THEN RAISE EXCEPTION 'Meta não encontrada'; END IF;
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
DECLARE v_tenant uuid; v_colab uuid; v_aval uuid; v_owner uuid; v_periodo text; v_path text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT id INTO v_colab FROM people.colaboradores WHERE user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;
  SELECT a.id, a.colaborador_id, m.periodo, an.storage_path INTO v_aval, v_owner, v_periodo, v_path
    FROM people.avaliacoes_pdi_metas_anexos an
    JOIN people.avaliacoes_pdi_metas_individuais m ON m.id = an.meta_id
    JOIN people.avaliacoes_pdi a ON a.id = m.avaliacao_pdi_id AND a.tenant_id = v_tenant
   WHERE an.id = p_anexo_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM v_colab THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_periodos
              WHERE avaliacao_pdi_id = v_aval AND periodo = v_periodo AND enviado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Período já enviado — não dá para remover o anexo';
  END IF;
  DELETE FROM people.avaliacoes_pdi_metas_anexos WHERE id = p_anexo_id;
  RETURN jsonb_build_object('id', p_anexo_id, 'storage_path', v_path);
END;
$$;

-- ---------------------------------------------------------------------
-- 8. Coordenador/sócio: reabrir um período enviado
--    Só quem vê o colaborador na equipe (sócio vê todos; coordenador, a
--    própria área) e nunca o próprio período. O colaborador é avisado na
--    caixa de entrada.
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

  UPDATE people.avaliacoes_pdi_metas_periodos
     SET enviado_em = NULL, reaberto_em = now(), reaberto_por = auth.uid()
   WHERE avaliacao_pdi_id = p_avaliacao_id AND periodo = p_periodo AND enviado_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este período não está enviado'; END IF;

  -- o aviso de "enviou" deixa de ser pendência de quem ia avaliar
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
-- 9. Painel de metas — colaborador vê o próprio; quem avalia vê a equipe
--    (sócio/adm VLMA: todos; coordenador: a própria área).
--    Devolve linhas cruas; as agregações ficam no front (testadas).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_painel_metas_pdi(p_ano integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
    WITH pessoas AS (
      SELECT col.id AS colaborador_id, col.nome, a.id AS avaliacao_id,
             COALESCE(NULLIF(a.area_nome_snapshot, ''), ar.nome, 'Sem área') AS area,
             COALESCE(a.cargo_nome_snapshot, cg.nome) AS cargo
        FROM people.colaboradores col
        LEFT JOIN people.avaliacoes_pdi a ON a.colaborador_id = col.id AND a.ano = p_ano AND a.tenant_id = v_tenant
        LEFT JOIN people.areas ar ON ar.id = col.area_id AND ar.tenant_id = v_tenant
        LEFT JOIN people.cargos cg ON cg.id = col.cargo_id
       WHERE col.tenant_id = v_tenant
         AND (col.ativo OR a.id IS NOT NULL)
         AND CASE v_escopo
               WHEN 'todos' THEN true
               WHEN 'area' THEN col.area_id = v_area
               ELSE col.id = v_colab END
    )
    SELECT jsonb_build_object(
      'ano', p_ano,
      'escopo', v_escopo,
      'area_nome', v_area_nome,
      'regua', (SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', f.codigo, 'rotulo', f.rotulo, 'ordem', f.ordem) ORDER BY f.ordem), '[]'::jsonb)
                  FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id = v_tenant),
      'pessoas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'colaborador_id', p.colaborador_id, 'nome', p.nome, 'area', p.area,
                     'cargo', p.cargo, 'avaliacao_id', p.avaliacao_id) ORDER BY p.area, p.nome), '[]'::jsonb) FROM pessoas p),
      'metas', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'meta_id', m.id, 'colaborador_id', p.colaborador_id, 'periodo', m.periodo, 'nome', m.nome,
                   'faixa_auto', m.faixa_auto, 'faixa_final', m.faixa_final,
                   'progresso_pct', COALESCE(m.progresso_pct, 0),
                   'qtd_anexos', (SELECT count(*) FROM people.avaliacoes_pdi_metas_anexos an WHERE an.meta_id = m.id))
                   ORDER BY p.nome, array_position(ARRAY['S1','S2','T1','T2','T3','T4']::varchar[], m.periodo), m.ordem), '[]'::jsonb)
                  FROM pessoas p JOIN people.avaliacoes_pdi_metas_individuais m ON m.avaliacao_pdi_id = p.avaliacao_id),
      'envios', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'colaborador_id', p.colaborador_id, 'periodo', pe.periodo, 'enviado_em', pe.enviado_em)), '[]'::jsonb)
                  FROM pessoas p JOIN people.avaliacoes_pdi_metas_periodos pe ON pe.avaliacao_pdi_id = p.avaliacao_id
                 WHERE pe.enviado_em IS NOT NULL)
    )
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 10. Caixa de entrada — aba PDI
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.listar_caixa_pdi(p_limite integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT n.id, n.tipo, n.periodo, n.titulo, n.created_at, n.lido_at, n.avaliacao_pdi_id,
           CASE n.tipo WHEN 'periodo_reaberto' THEN '/avaliacoes-pdi/meu'
                       ELSE '/avaliacoes-pdi/equipe/' || n.avaliacao_pdi_id::text || '?aba=metas' END AS link
      FROM people.pdi_notificacoes n
     WHERE n.destinatario_user_id = auth.uid()
     ORDER BY n.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limite, 30), 1), 100)
  ) x;
$$;

CREATE OR REPLACE FUNCTION public.contar_caixa_pdi_pendentes()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
  SELECT count(*)::int FROM people.pdi_notificacoes
   WHERE destinatario_user_id = auth.uid() AND lido_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.marcar_caixa_pdi_lida(p_ids uuid[] DEFAULT NULL, p_avaliacao_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $$
DECLARE v_n int;
BEGIN
  IF p_ids IS NULL AND p_avaliacao_id IS NULL THEN RETURN 0; END IF;
  UPDATE people.pdi_notificacoes SET lido_at = now()
   WHERE destinatario_user_id = auth.uid() AND lido_at IS NULL
     AND (p_ids IS NULL OR id = ANY(p_ids))
     AND (p_avaliacao_id IS NULL OR avaliacao_pdi_id = p_avaliacao_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------
-- 11. Storage: bucket privado; ler = dono ou quem vê o colaborador na
--     equipe; gravar = dono com o período aberto; apagar = dono com o
--     período aberto (ou meta já removida).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pdi_anexo_meta_acesso(p_name text, p_modo text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'people', 'core'
AS $$
DECLARE v_parts text[]; v_tenant uuid; v_aval uuid; v_meta uuid; v_colab uuid; v_dono boolean;
        v_periodo text; v_meta_existe boolean; v_enviado boolean;
        v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  v_parts := storage.foldername(p_name);
  IF COALESCE(array_length(v_parts, 1), 0) < 3 THEN RETURN false; END IF;
  IF v_parts[1] !~* v_uuid OR v_parts[2] !~* v_uuid OR v_parts[3] !~* v_uuid THEN RETURN false; END IF;

  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL OR v_tenant::text <> lower(v_parts[1]) THEN RETURN false; END IF;
  v_aval := v_parts[2]::uuid; v_meta := v_parts[3]::uuid;

  SELECT a.colaborador_id INTO v_colab FROM people.avaliacoes_pdi a WHERE a.id = v_aval AND a.tenant_id = v_tenant;
  IF v_colab IS NULL THEN RETURN false; END IF;
  v_dono := EXISTS (SELECT 1 FROM people.colaboradores WHERE id = v_colab AND user_id = auth.uid());

  SELECT m.periodo INTO v_periodo FROM people.avaliacoes_pdi_metas_individuais m
   WHERE m.id = v_meta AND m.avaliacao_pdi_id = v_aval;
  v_meta_existe := FOUND;
  v_enviado := v_meta_existe AND EXISTS (SELECT 1 FROM people.avaliacoes_pdi_metas_periodos
                  WHERE avaliacao_pdi_id = v_aval AND periodo = v_periodo AND enviado_em IS NOT NULL);

  IF p_modo = 'ler' THEN
    RETURN v_meta_existe AND (v_dono OR public.pdi_ve_colaborador_na_equipe(v_colab));
  ELSIF p_modo = 'gravar' THEN
    RETURN v_dono AND v_meta_existe AND NOT v_enviado;
  ELSIF p_modo = 'apagar' THEN
    RETURN v_dono AND NOT v_enviado;
  END IF;
  RETURN false;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('pdi-metas-anexos', 'pdi-metas-anexos', false, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS auth_read_pdi_metas_anexos ON storage.objects;
DROP POLICY IF EXISTS auth_insert_pdi_metas_anexos ON storage.objects;
DROP POLICY IF EXISTS auth_delete_pdi_metas_anexos ON storage.objects;
CREATE POLICY auth_read_pdi_metas_anexos ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdi-metas-anexos' AND public.pdi_anexo_meta_acesso(name, 'ler'));
CREATE POLICY auth_insert_pdi_metas_anexos ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdi-metas-anexos' AND public.pdi_anexo_meta_acesso(name, 'gravar'));
CREATE POLICY auth_delete_pdi_metas_anexos ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pdi-metas-anexos' AND public.pdi_anexo_meta_acesso(name, 'apagar'));

-- ---------------------------------------------------------------------
-- 12. RPCs existentes ajustadas (fonte: produção, pg_get_functiondef)
-- ---------------------------------------------------------------------

-- 12a. salvar_minha_avaliacao_pdi deixa de mexer nas metas (agora são
--      salvas por período em salvar_minhas_metas_pdi). p_metas fica na
--      assinatura só por compatibilidade e é ignorado — antes ele apagava
--      toda meta ausente do payload, o que levaria junto as metas de outros
--      períodos.
CREATE OR REPLACE FUNCTION public.salvar_minha_avaliacao_pdi(p_avaliacao_id uuid, p_skills jsonb, p_dna jsonb, p_metas jsonb, p_feedbacks jsonb, p_enviar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE v_tenant uuid; v_colab uuid; v_owner uuid; v_bloq boolean; v_item jsonb;
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

  -- metas: ignoradas aqui de propósito (ver salvar_minhas_metas_pdi)

  UPDATE people.avaliacoes_pdi SET updated_at=now(),
    status = CASE WHEN p_enviar THEN 'autoavaliacao_enviada' ELSE status END,
    autoavaliacao_enviada_at = CASE WHEN p_enviar THEN now() ELSE autoavaliacao_enviada_at END,
    bloqueada = CASE WHEN p_enviar THEN true ELSE bloqueada END
    WHERE id=p_avaliacao_id;

  RETURN jsonb_build_object('id', p_avaliacao_id, 'enviada', p_enviar);
END;
$function$;

-- 12b. get_equipe_avaliacoes_pdi: + metas_periodos_enviados por pessoa.
CREATE OR REPLACE FUNCTION public.get_equipe_avaliacoes_pdi(p_ano integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE v_tenant uuid; v_cat people.colaborador_categoria; v_area uuid; v_area_nome text; v_ve_tudo boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;

  SELECT col.categoria, col.area_id, a.nome INTO v_cat, v_area, v_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
  WHERE col.user_id=auth.uid() AND col.tenant_id=v_tenant LIMIT 1;

  v_ve_tudo := (v_cat = 'socio') OR (v_cat = 'administrativo' AND v_area_nome = 'VLMA');

  RETURN jsonb_build_object(
    'ano', p_ano,
    'escopo', CASE WHEN v_ve_tudo THEN 'todos' ELSE 'area' END,
    'total_pessoas', (
      SELECT count(*) FROM people.colaboradores col
      WHERE col.tenant_id = v_tenant AND col.ativo
        AND (v_ve_tudo OR col.area_id = v_area)
    ),
    'iniciadas', (
      SELECT count(*) FROM people.avaliacoes_pdi a
      JOIN people.colaboradores col ON col.id = a.colaborador_id
      WHERE a.tenant_id = v_tenant AND a.ano = p_ano
        AND (v_ve_tudo OR col.area_id = v_area)
    ),
    'itens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.colaborador_nome), '[]'::jsonb) FROM (
        SELECT a.id,
               COALESCE(a.status::text, 'nao_iniciada') AS status,
               a.faixa_final_geral,
               a.resultado::text AS resultado,
               a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at, a.progressao_aplicada_at,
               COALESCE(a.cargo_nome_snapshot, cg.nome) AS cargo_nome_snapshot,
               COALESCE(a.area_nome_snapshot, ar.nome) AS area_nome_snapshot,
               a.carreira_codigo,
               a.adicional_snapshot,
               col.nome AS colaborador_nome,
               col.categoria::text AS categoria,
               (SELECT COALESCE(jsonb_agg(pe.periodo ORDER BY array_position(ARRAY['S1','S2','T1','T2','T3','T4']::varchar[], pe.periodo)), '[]'::jsonb)
                  FROM people.avaliacoes_pdi_metas_periodos pe
                 WHERE pe.avaliacao_pdi_id = a.id AND pe.enviado_em IS NOT NULL) AS metas_periodos_enviados
        FROM people.colaboradores col
        LEFT JOIN people.avaliacoes_pdi a
               ON a.colaborador_id = col.id AND a.ano = p_ano AND a.tenant_id = v_tenant
        LEFT JOIN people.cargos cg ON cg.id = col.cargo_id
        LEFT JOIN people.areas ar ON ar.id = col.area_id AND ar.tenant_id = v_tenant
        WHERE col.tenant_id = v_tenant
          AND (v_ve_tudo OR col.area_id = v_area)
          AND (col.ativo OR a.id IS NOT NULL)
      ) x
    )
  );
END;
$function$;

-- 12c. get_avaliacao_pdi_gestor: passa a respeitar a área (antes qualquer
--      coordenador abria qualquer avaliação pelo id) e devolve as metas com
--      período, comentário e anexos + o estado de envio de cada período.
CREATE OR REPLACE FUNCTION public.get_avaliacao_pdi_gestor(p_avaliacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE v_tenant uuid; v_carreira varchar; v_colab uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;
  SELECT carreira_codigo, colaborador_id INTO v_carreira, v_colab FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;
  IF NOT public.pdi_ve_colaborador_na_equipe(v_colab) THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;

  RETURN jsonb_build_object(
    'avaliacao', (SELECT to_jsonb(x) FROM (
        SELECT a.id, a.ano, a.status, a.bloqueada, a.faixa_final_geral, a.resultado::text AS resultado,
               a.parecer_gestor, a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at,
               a.gestor_nome, a.progressao_aplicada_at, a.novo_salario, a.novo_cargo_id, a.salario_anterior,
               a.bonus_pdi, a.bonus_13o, a.bonus_performance_plus, a.bonus_comercial,
               a.cargo_id_snapshot, a.cargo_nome_snapshot, a.nivel_codigo_snapshot, a.carreira_codigo,
               a.adicional_snapshot, a.area_nome_snapshot,
               col.nome AS colaborador_nome, col.salario AS salario_atual, col.cargo_id AS cargo_atual_id,
               (col.user_id IS DISTINCT FROM auth.uid()) AS pode_reabrir_metas
        FROM people.avaliacoes_pdi a
        JOIN people.colaboradores col ON col.id = a.colaborador_id
        WHERE a.id = p_avaliacao_id) x),
    'regua', (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id=v_tenant),
    'skills', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.trilha, s.pilar_numero, s.item_codigo),'[]'::jsonb) FROM people.avaliacoes_pdi_skills_carreira s WHERE s.avaliacao_pdi_id=p_avaliacao_id),
    'dna', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.numero),'[]'::jsonb) FROM people.avaliacoes_pdi_dna_vlma d WHERE d.avaliacao_pdi_id=p_avaliacao_id),
    'metas', public.pdi_metas_json(p_avaliacao_id),
    'metas_periodos', public.pdi_periodos_json(p_avaliacao_id),
    'feedbacks', (SELECT COALESCE(jsonb_agg(to_jsonb(fb) ORDER BY fb.mes),'[]'::jsonb) FROM people.avaliacoes_pdi_feedbacks_mensais fb WHERE fb.avaliacao_pdi_id=p_avaliacao_id),
    'cargos', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.nivel, c.nome),'[]'::jsonb) FROM (
        SELECT ca.id, ca.nome, ca.codigo, ca.nivel,
               (SELECT qr.salario FROM people.pdi_quadro_remuneracao qr
                 WHERE qr.tenant_id=v_tenant AND qr.carreira_codigo=v_carreira AND qr.cargo_codigo=ca.codigo AND qr.coluna='I'
                 LIMIT 1) AS salario_sugerido
        FROM people.cargos ca WHERE ca.tenant_id=v_tenant AND ca.ativo IS NOT FALSE) c)
  );
END;
$function$;

-- 12d. salvar_avaliacao_gestor e aplicar_progressao_pdi: mesma trava de
--      área (corpo idêntico ao de produção + a checagem).
CREATE OR REPLACE FUNCTION public.salvar_avaliacao_gestor(p_avaliacao_id uuid, p_skills jsonb, p_metas jsonb, p_faixa_final_geral character varying, p_resultado text, p_parecer text, p_bonus jsonb, p_enviar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE v_tenant uuid; v_item jsonb; v_nome varchar; v_colab uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;
  SELECT colaborador_id INTO v_colab FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF v_colab IS NULL OR NOT public.pdi_ve_colaborador_na_equipe(v_colab) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_progressao_pdi(p_avaliacao_id uuid, p_novo_cargo_id uuid, p_novo_salario numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE v_tenant uuid; v_colab uuid; v_cargo_atual uuid; v_sal_atual numeric;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para aplicar progressão'; END IF;

  SELECT colaborador_id INTO v_colab FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF v_colab IS NULL THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;
  IF NOT public.pdi_ve_colaborador_na_equipe(v_colab) THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;

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
$function$;

-- ---------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pdi_ve_colaborador_na_equipe(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_minhas_metas_pdi(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_minhas_metas_pdi(uuid, text, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_anexo_meta_pdi(uuid, text, text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remover_anexo_meta_pdi(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reabrir_periodo_metas_pdi(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_painel_metas_pdi(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_caixa_pdi(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contar_caixa_pdi_pendentes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marcar_caixa_pdi_lida(uuid[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pdi_anexo_meta_acesso(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pdi_ve_colaborador_na_equipe(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_minhas_metas_pdi(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.salvar_minhas_metas_pdi(uuid, text, jsonb, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_anexo_meta_pdi(uuid, text, text, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remover_anexo_meta_pdi(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reabrir_periodo_metas_pdi(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_painel_metas_pdi(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.listar_caixa_pdi(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contar_caixa_pdi_pendentes() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_caixa_pdi_lida(uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pdi_anexo_meta_acesso(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pdi_rotulo_periodo(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
