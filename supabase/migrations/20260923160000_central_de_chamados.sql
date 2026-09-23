-- Central de chamados (pedido do Filipe, 22/09/2026; decisões de 09/09 em
-- docs/especificacao-indicadores-e-chamados-09-09-2026.pdf).
--
-- Central INTERNA: qualquer colaborador logado abre chamado de suporte/sugestão
-- do ERP; o Filipe (e quem ele indicar via permissão) acompanha, responde e
-- muda o status. Nada sai para a Flowcode e não há e-mail — o aviso é o badge
-- do inbox flutuante que já existe (contar_chamados_pendentes).
--
-- Migration 100% aditiva: schema ops novo, 3 tabelas, bucket privado, permissão
-- ops.chamados.responder (ligada aos roles socio e "Sócio Diretor") e 5 RPCs
-- SECURITY DEFINER. Mesmo padrão de create_mensagem_avulsa /
-- list_mensagens_avulsas_inbox: tenant via core.tenant_users, nome/foto do
-- autor via people.colaboradores, permissão via public.get_user_permissions.

-- ---------------------------------------------------------------------
-- 1. Schema ops
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ops;

GRANT USAGE ON SCHEMA ops TO service_role;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------
-- autor_id / responsavel_id guardam o auth user_id (não o id do colaborador):
-- é o identificador que o front tem em mãos e que as RPCs recebem em
-- p_user_id; nome e foto vêm de people.colaboradores pelo user_id.
CREATE TABLE IF NOT EXISTS ops.chamados (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  -- Sequência por tenant (finance.next_tenant_counter, chave 'chamado_numero'),
  -- igual às notas/lotes de faturamento.
  numero                 BIGINT NOT NULL,
  categoria              TEXT NOT NULL CHECK (categoria IN ('bug', 'sugestao', 'duvida')),
  modulo                 TEXT NOT NULL CHECK (modulo IN (
                           'timesheet', 'despesas', 'faturamento', 'contratos',
                           'crm', 'pessoas', 'relatorios', 'outro')),
  titulo                 TEXT NOT NULL,
  descricao              TEXT NOT NULL,
  urgencia               TEXT NOT NULL DEFAULT 'normal' CHECK (urgencia IN ('normal', 'urgente')),
  status                 TEXT NOT NULL DEFAULT 'recebido' CHECK (status IN (
                           'recebido', 'em_analise', 'feito', 'nao_sera_feito')),
  -- URL em que o colaborador estava ao abrir (o botão flutuante preenche).
  rota                   TEXT,
  autor_id               UUID NOT NULL,
  -- Quem assumiu: preenchido na primeira mudança de status.
  responsavel_id         UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvido_em           TIMESTAMPTZ,
  -- Badges: NULL = há novidade que aquele lado ainda não abriu.
  -- autor_lido_em: novidade para o autor (resposta/mudança de status).
  -- respondentes_lido_em: novidade para quem responde (chamado novo ou
  -- mensagem do autor).
  autor_lido_em          TIMESTAMPTZ DEFAULT now(),
  respondentes_lido_em   TIMESTAMPTZ,
  UNIQUE (tenant_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_chamados_tenant_status_updated
  ON ops.chamados (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chamados_autor
  ON ops.chamados (autor_id, autor_lido_em)
  WHERE autor_lido_em IS NULL;

CREATE TABLE IF NOT EXISTS ops.chamado_mensagens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id    UUID NOT NULL REFERENCES ops.chamados(id) ON DELETE CASCADE,
  autor_id      UUID NOT NULL,
  mensagem      TEXT NOT NULL,
  -- Preenchido quando a mensagem acompanha uma mudança de status.
  status_novo   TEXT CHECK (status_novo IN ('recebido', 'em_analise', 'feito', 'nao_sera_feito')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chamado_mensagens_chamado
  ON ops.chamado_mensagens (chamado_id, created_at);

-- Anexos ficam no bucket chamados-anexos (path <tenant_id>/<chamado_id>/<ts>-<nome>);
-- aqui só o metadado. mensagem_id NULL = anexo do chamado em si.
CREATE TABLE IF NOT EXISTS ops.chamado_anexos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     UUID NOT NULL REFERENCES ops.chamados(id) ON DELETE CASCADE,
  mensagem_id    UUID REFERENCES ops.chamado_mensagens(id) ON DELETE CASCADE,
  arquivo_nome   TEXT NOT NULL,
  mime_type      TEXT,
  tamanho_bytes  BIGINT,
  storage_path   TEXT NOT NULL,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chamado_anexos_chamado
  ON ops.chamado_anexos (chamado_id);

-- ---------------------------------------------------------------------
-- 3. RLS: só service_role acessa direto; o front passa pelas RPCs
--    SECURITY DEFINER (mesmo espírito das tabelas contracts.solicitacao_*,
--    que o client nunca lê direto).
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.chamados, ops.chamado_mensagens, ops.chamado_anexos
  TO service_role;

ALTER TABLE ops.chamados          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.chamado_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.chamado_anexos    ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ops' AND tablename = 'chamados'
                 AND policyname = 'service_role_all_chamados') THEN
    CREATE POLICY service_role_all_chamados ON ops.chamados
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ops' AND tablename = 'chamado_mensagens'
                 AND policyname = 'service_role_all_chamado_mensagens') THEN
    CREATE POLICY service_role_all_chamado_mensagens ON ops.chamado_mensagens
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ops' AND tablename = 'chamado_anexos'
                 AND policyname = 'service_role_all_chamado_anexos') THEN
    CREATE POLICY service_role_all_chamado_anexos ON ops.chamado_anexos
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Bucket privado chamados-anexos (2.7: print/vídeo até 25 MB, vários por
--    chamado). Mesmo padrão de colaboradores-fotos (20260723140000): bucket
--    privado + policies para authenticated. Todo mundo do tenant vê todos os
--    chamados (2.5c), então SELECT e INSERT valem para qualquer logado do
--    tenant — a primeira pasta do path é o tenant_id.
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chamados-anexos', 'chamados-anexos', false, 26214400)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'auth_read_chamados_anexos'
  ) THEN
    CREATE POLICY "auth_read_chamados_anexos"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'chamados-anexos'
        AND EXISTS (
          SELECT 1 FROM core.tenant_users tu
          WHERE tu.user_id = auth.uid()
            AND tu.status = 'ativo'
            AND tu.tenant_id::text = (storage.foldername(name))[1]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'auth_insert_chamados_anexos'
  ) THEN
    CREATE POLICY "auth_insert_chamados_anexos"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'chamados-anexos'
        AND EXISTS (
          SELECT 1 FROM core.tenant_users tu
          WHERE tu.user_id = auth.uid()
            AND tu.status = 'ativo'
            AND tu.tenant_id::text = (storage.foldername(name))[1]
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Permissão ops.chamados.responder → roles socio e "Sócio Diretor".
--    Abrir chamado não exige permissão (2.1a: qualquer logado abre).
-- ---------------------------------------------------------------------
INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT t.id, 'ops.chamados.responder', 'Responder e mudar status dos chamados', 'ops'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p
  WHERE p.tenant_id = t.id AND p.chave = 'ops.chamados.responder'
);

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.tenant_id = r.tenant_id AND p.chave = 'ops.chamados.responder'
WHERE r.nome IN ('socio', 'Sócio Diretor')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Helpers internos (ops.*, não expostos ao client)
-- ---------------------------------------------------------------------
-- Tenant do usuário (padrão de create_mensagem_avulsa).
CREATE OR REPLACE FUNCTION ops.chamado_tenant(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  RETURN v_tenant_id;
END;
$function$;

-- Quem "responde chamados" (2.5c). Curinga 'ops.*' e '*' seguem o padrão das
-- policies de faturamento-documentos.
CREATE OR REPLACE FUNCTION ops.chamado_pode_responder(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('ops.chamados.responder', 'ops.chamados.*', 'ops.*', '*')
  );
$function$;

-- Autor como o front espera: {id, nome, foto_url} (nome/foto de
-- people.colaboradores, como list_mensagens_avulsas_inbox).
CREATE OR REPLACE FUNCTION ops.chamado_pessoa(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $function$
  SELECT CASE WHEN p_user_id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'id', p_user_id,
      'nome', COALESCE((SELECT c.nome FROM people.colaboradores c
                        WHERE c.user_id = p_user_id AND c.tenant_id = p_tenant_id LIMIT 1), 'Colaborador'),
      'foto_url', (SELECT c.foto_url FROM people.colaboradores c
                   WHERE c.user_id = p_user_id AND c.tenant_id = p_tenant_id LIMIT 1)
    )
  END;
$function$;

-- Valida e grava os anexos de um payload [{arquivo_nome, mime_type,
-- tamanho_bytes, storage_path}]. Limites de 2.7: ≤ 10 por envio, ≤ 25 MB cada,
-- path dentro da pasta do tenant.
CREATE OR REPLACE FUNCTION ops.chamado_gravar_anexos(
  p_tenant_id uuid,
  p_chamado_id uuid,
  p_mensagem_id uuid,
  p_user_id uuid,
  p_anexos jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'ops'
AS $function$
DECLARE
  v_anexo jsonb;
  v_total int := 0;
  v_tamanho bigint;
  v_path text;
BEGIN
  IF p_anexos IS NULL OR jsonb_typeof(p_anexos) <> 'array' THEN
    RETURN 0;
  END IF;

  IF jsonb_array_length(p_anexos) > 10 THEN
    RAISE EXCEPTION 'No máximo 10 anexos por envio';
  END IF;

  FOR v_anexo IN SELECT value FROM jsonb_array_elements(p_anexos)
  LOOP
    v_path := NULLIF(trim(v_anexo->>'storage_path'), '');
    IF v_path IS NULL THEN
      RAISE EXCEPTION 'Anexo sem storage_path';
    END IF;
    IF v_path NOT LIKE p_tenant_id::text || '/%' THEN
      RAISE EXCEPTION 'Anexo fora da pasta do tenant';
    END IF;

    v_tamanho := NULLIF(v_anexo->>'tamanho_bytes', '')::bigint;
    IF v_tamanho IS NOT NULL AND v_tamanho > 26214400 THEN
      RAISE EXCEPTION 'Anexo acima de 25 MB: %', COALESCE(v_anexo->>'arquivo_nome', v_path);
    END IF;

    INSERT INTO ops.chamado_anexos (
      chamado_id, mensagem_id, arquivo_nome, mime_type, tamanho_bytes, storage_path, created_by
    ) VALUES (
      p_chamado_id,
      p_mensagem_id,
      COALESCE(NULLIF(trim(v_anexo->>'arquivo_nome'), ''), 'anexo'),
      NULLIF(v_anexo->>'mime_type', ''),
      v_tamanho,
      v_path,
      p_user_id
    );
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$function$;

-- JSON dos anexos de um chamado/mensagem (storage_path incluso; quem lê assina).
CREATE OR REPLACE FUNCTION ops.chamado_anexos_json(p_chamado_id uuid, p_mensagem_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'ops'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'arquivo_nome', a.arquivo_nome,
    'mime_type', a.mime_type,
    'tamanho_bytes', a.tamanho_bytes,
    'storage_path', a.storage_path,
    'created_at', a.created_at
  ) ORDER BY a.created_at), '[]'::jsonb)
  FROM ops.chamado_anexos a
  WHERE a.chamado_id = p_chamado_id
    AND a.mensagem_id IS NOT DISTINCT FROM p_mensagem_id;
$function$;

-- ---------------------------------------------------------------------
-- 7. RPC criar_chamado(p_user_id, p_payload) → {id, numero}
--    payload: {categoria, modulo, titulo, descricao, urgencia, rota,
--              anexos:[{arquivo_nome, mime_type, tamanho_bytes, storage_path}]}
--    Aceita também "id" (uuid gerado no front) para que o upload dos anexos
--    em <tenant>/<chamado_id>/ possa acontecer antes da gravação.
--    A descrição é o corpo do chamado; não gera mensagem inicial.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_chamado(
  p_user_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'ops', 'people', 'finance'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_numero bigint;
  v_categoria text;
  v_modulo text;
  v_titulo text;
  v_descricao text;
  v_urgencia text;
  v_rota text;
BEGIN
  -- Segurança (insider): em chamada autenticada, usa sempre a identidade do token.
  p_user_id := COALESCE(auth.uid(), p_user_id);
  v_tenant_id := ops.chamado_tenant(p_user_id);

  v_categoria := NULLIF(trim(p_payload->>'categoria'), '');
  v_modulo    := COALESCE(NULLIF(trim(p_payload->>'modulo'), ''), 'outro');
  v_titulo    := NULLIF(trim(p_payload->>'titulo'), '');
  v_descricao := NULLIF(trim(p_payload->>'descricao'), '');
  v_urgencia  := COALESCE(NULLIF(trim(p_payload->>'urgencia'), ''), 'normal');
  v_rota      := NULLIF(trim(p_payload->>'rota'), '');

  IF v_categoria IS NULL OR v_categoria NOT IN ('bug', 'sugestao', 'duvida') THEN
    RAISE EXCEPTION 'Categoria inválida (bug, sugestao ou duvida)';
  END IF;
  IF v_modulo NOT IN ('timesheet', 'despesas', 'faturamento', 'contratos', 'crm', 'pessoas', 'relatorios', 'outro') THEN
    RAISE EXCEPTION 'Módulo inválido';
  END IF;
  IF v_urgencia NOT IN ('normal', 'urgente') THEN
    RAISE EXCEPTION 'Urgência inválida (normal ou urgente)';
  END IF;
  IF v_titulo IS NULL THEN
    RAISE EXCEPTION 'Título é obrigatório';
  END IF;
  IF length(v_titulo) > 140 THEN
    RAISE EXCEPTION 'Título deve ter no máximo 140 caracteres';
  END IF;
  IF v_descricao IS NULL THEN
    RAISE EXCEPTION 'Descrição é obrigatória';
  END IF;
  IF length(v_descricao) > 5000 THEN
    RAISE EXCEPTION 'Descrição deve ter no máximo 5000 caracteres';
  END IF;
  IF v_rota IS NOT NULL AND length(v_rota) > 500 THEN
    v_rota := left(v_rota, 500);
  END IF;

  v_id := COALESCE(NULLIF(p_payload->>'id', '')::uuid, gen_random_uuid());
  v_numero := finance.next_tenant_counter(v_tenant_id, 'chamado_numero');

  INSERT INTO ops.chamados (
    id, tenant_id, numero, categoria, modulo, titulo, descricao, urgencia,
    status, rota, autor_id, autor_lido_em, respondentes_lido_em
  ) VALUES (
    v_id, v_tenant_id, v_numero, v_categoria, v_modulo, v_titulo, v_descricao, v_urgencia,
    'recebido', v_rota, p_user_id, now(), NULL
  );

  PERFORM ops.chamado_gravar_anexos(v_tenant_id, v_id, NULL, p_user_id, p_payload->'anexos');

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_chamado(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. RPC listar_chamados(...) → {pode_responder, resumo, itens}
--    Todos do tenant veem todos os chamados (2.5c). "resumo" ignora o filtro
--    de status (os cards de status são os próprios filtros) mas respeita os
--    demais. Ordem: urgentes abertos primeiro, depois updated_at desc.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.listar_chamados(
  p_user_id uuid,
  p_status text DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_modulo text DEFAULT NULL,
  p_somente_meus boolean DEFAULT false,
  p_busca text DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'ops', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pode_responder boolean;
  v_busca text;
  v_resumo jsonb;
  v_itens jsonb;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  v_tenant_id := ops.chamado_tenant(p_user_id);
  v_pode_responder := ops.chamado_pode_responder(p_user_id);
  v_busca := NULLIF(trim(p_busca), '');

  SELECT jsonb_build_object(
    'recebido',         COUNT(*) FILTER (WHERE c.status = 'recebido'),
    'em_analise',       COUNT(*) FILTER (WHERE c.status = 'em_analise'),
    'feito',            COUNT(*) FILTER (WHERE c.status = 'feito'),
    'nao_sera_feito',   COUNT(*) FILTER (WHERE c.status = 'nao_sera_feito'),
    'urgentes_abertos', COUNT(*) FILTER (WHERE c.urgencia = 'urgente'
                                           AND c.status IN ('recebido', 'em_analise'))
  )
  INTO v_resumo
  FROM ops.chamados c
  WHERE c.tenant_id = v_tenant_id
    AND (p_categoria IS NULL OR c.categoria = p_categoria)
    AND (p_modulo IS NULL OR c.modulo = p_modulo)
    AND (NOT COALESCE(p_somente_meus, false) OR c.autor_id = p_user_id)
    AND (v_busca IS NULL
         OR c.titulo ILIKE '%' || v_busca || '%'
         OR c.descricao ILIKE '%' || v_busca || '%'
         OR c.numero::text = v_busca);

  SELECT COALESCE(jsonb_agg(row_data ORDER BY urgente_aberto DESC, updated_at DESC), '[]'::jsonb)
  INTO v_itens
  FROM (
    SELECT
      jsonb_build_object(
        'id', c.id,
        'numero', c.numero,
        'categoria', c.categoria,
        'modulo', c.modulo,
        'titulo', c.titulo,
        'urgencia', c.urgencia,
        'status', c.status,
        'autor', ops.chamado_pessoa(v_tenant_id, c.autor_id),
        'responsavel', CASE WHEN c.responsavel_id IS NULL THEN NULL
                            ELSE ops.chamado_pessoa(v_tenant_id, c.responsavel_id) - 'foto_url' END,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'total_mensagens', (SELECT COUNT(*) FROM ops.chamado_mensagens m WHERE m.chamado_id = c.id),
        'total_anexos', (SELECT COUNT(*) FROM ops.chamado_anexos a WHERE a.chamado_id = c.id),
        -- Não lido para o usuário atual: autor olha autor_lido_em; quem
        -- responde olha respondentes_lido_em (só nos chamados dos outros).
        'nao_lido', CASE
                      WHEN c.autor_id = p_user_id THEN c.autor_lido_em IS NULL
                      WHEN v_pode_responder THEN c.respondentes_lido_em IS NULL
                      ELSE false
                    END
      ) AS row_data,
      (c.urgencia = 'urgente' AND c.status IN ('recebido', 'em_analise')) AS urgente_aberto,
      c.updated_at
    FROM ops.chamados c
    WHERE c.tenant_id = v_tenant_id
      AND (p_status IS NULL OR c.status = p_status)
      AND (p_categoria IS NULL OR c.categoria = p_categoria)
      AND (p_modulo IS NULL OR c.modulo = p_modulo)
      AND (NOT COALESCE(p_somente_meus, false) OR c.autor_id = p_user_id)
      AND (v_busca IS NULL
           OR c.titulo ILIKE '%' || v_busca || '%'
           OR c.descricao ILIKE '%' || v_busca || '%'
           OR c.numero::text = v_busca)
    ORDER BY urgente_aberto DESC, c.updated_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
  ) sub;

  RETURN jsonb_build_object(
    'pode_responder', v_pode_responder,
    'resumo', v_resumo,
    'itens', v_itens
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.listar_chamados(uuid, text, text, text, boolean, text, int)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. RPC obter_chamado(p_user_id, p_chamado_id) → chamado completo
--    Efeito colateral: marca lido para quem abriu (autor → autor_lido_em;
--    quem responde → respondentes_lido_em).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obter_chamado(
  p_user_id uuid,
  p_chamado_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'ops', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pode_responder boolean;
  v_chamado ops.chamados%ROWTYPE;
  v_mensagens jsonb;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  v_tenant_id := ops.chamado_tenant(p_user_id);
  v_pode_responder := ops.chamado_pode_responder(p_user_id);

  SELECT * INTO v_chamado
  FROM ops.chamados c
  WHERE c.id = p_chamado_id AND c.tenant_id = v_tenant_id;

  IF v_chamado.id IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado';
  END IF;

  -- Marca lido para o lado de quem abriu. Não mexe em updated_at: abrir para
  -- ler não é novidade.
  IF v_chamado.autor_id = p_user_id AND v_chamado.autor_lido_em IS NULL THEN
    UPDATE ops.chamados SET autor_lido_em = now() WHERE id = v_chamado.id;
    v_chamado.autor_lido_em := now();
  END IF;
  IF v_pode_responder AND v_chamado.autor_id <> p_user_id AND v_chamado.respondentes_lido_em IS NULL THEN
    UPDATE ops.chamados SET respondentes_lido_em = now() WHERE id = v_chamado.id;
    v_chamado.respondentes_lido_em := now();
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'autor', ops.chamado_pessoa(v_tenant_id, m.autor_id),
    'mensagem', m.mensagem,
    'status_novo', m.status_novo,
    'created_at', m.created_at,
    'anexos', ops.chamado_anexos_json(m.chamado_id, m.id)
  ) ORDER BY m.created_at), '[]'::jsonb)
  INTO v_mensagens
  FROM ops.chamado_mensagens m
  WHERE m.chamado_id = v_chamado.id;

  RETURN jsonb_build_object(
    'id', v_chamado.id,
    'numero', v_chamado.numero,
    'categoria', v_chamado.categoria,
    'modulo', v_chamado.modulo,
    'titulo', v_chamado.titulo,
    'descricao', v_chamado.descricao,
    'urgencia', v_chamado.urgencia,
    'status', v_chamado.status,
    'rota', v_chamado.rota,
    'autor', ops.chamado_pessoa(v_tenant_id, v_chamado.autor_id),
    'responsavel', CASE WHEN v_chamado.responsavel_id IS NULL THEN NULL
                        ELSE ops.chamado_pessoa(v_tenant_id, v_chamado.responsavel_id) - 'foto_url' END,
    'created_at', v_chamado.created_at,
    'updated_at', v_chamado.updated_at,
    'resolvido_em', v_chamado.resolvido_em,
    'autor_lido_em', v_chamado.autor_lido_em,
    'respondentes_lido_em', v_chamado.respondentes_lido_em,
    'sou_autor', v_chamado.autor_id = p_user_id,
    'pode_responder', v_pode_responder,
    'anexos', ops.chamado_anexos_json(v_chamado.id, NULL),
    'mensagens', v_mensagens
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obter_chamado(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. RPC responder_chamado(p_user_id, p_chamado_id, p_mensagem, p_status, p_anexos)
--     Autor manda mensagem (sem mudar status); quem tem ops.chamados.responder
--     manda mensagem e/ou muda status. Mensagem vazia com status é permitida
--     (vira "Status alterado" com status_novo). Marca não-lido para o outro lado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.responder_chamado(
  p_user_id uuid,
  p_chamado_id uuid,
  p_mensagem text,
  p_status text DEFAULT NULL,
  p_anexos jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'ops', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pode_responder boolean;
  v_chamado ops.chamados%ROWTYPE;
  v_mensagem text;
  v_status text;
  v_mensagem_id uuid;
  v_sou_autor boolean;
  v_mudou_status boolean := false;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  v_tenant_id := ops.chamado_tenant(p_user_id);
  v_pode_responder := ops.chamado_pode_responder(p_user_id);

  SELECT * INTO v_chamado
  FROM ops.chamados c
  WHERE c.id = p_chamado_id AND c.tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_chamado.id IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado';
  END IF;

  v_sou_autor := (v_chamado.autor_id = p_user_id);
  IF NOT v_sou_autor AND NOT v_pode_responder THEN
    RAISE EXCEPTION 'Você não tem permissão para responder este chamado';
  END IF;

  v_mensagem := NULLIF(trim(p_mensagem), '');
  v_status := NULLIF(trim(p_status), '');

  IF v_status IS NOT NULL THEN
    IF NOT v_pode_responder THEN
      RAISE EXCEPTION 'Só quem responde chamados pode mudar o status';
    END IF;
    IF v_status NOT IN ('recebido', 'em_analise', 'feito', 'nao_sera_feito') THEN
      RAISE EXCEPTION 'Status inválido';
    END IF;
    IF v_status = v_chamado.status THEN
      v_status := NULL; -- sem mudança de fato
    END IF;
  END IF;

  IF v_mensagem IS NULL AND v_status IS NULL THEN
    RAISE EXCEPTION 'Escreva uma mensagem ou escolha um novo status';
  END IF;
  IF v_mensagem IS NOT NULL AND length(v_mensagem) > 5000 THEN
    RAISE EXCEPTION 'Mensagem deve ter no máximo 5000 caracteres';
  END IF;

  INSERT INTO ops.chamado_mensagens (chamado_id, autor_id, mensagem, status_novo)
  VALUES (v_chamado.id, p_user_id, COALESCE(v_mensagem, 'Status alterado'), v_status)
  RETURNING id INTO v_mensagem_id;

  PERFORM ops.chamado_gravar_anexos(v_tenant_id, v_chamado.id, v_mensagem_id, p_user_id, p_anexos);

  IF v_status IS NOT NULL THEN
    v_mudou_status := true;
    UPDATE ops.chamados
       SET status = v_status,
           responsavel_id = COALESCE(responsavel_id, p_user_id),
           resolvido_em = CASE WHEN v_status IN ('feito', 'nao_sera_feito') THEN now() ELSE NULL END
     WHERE id = v_chamado.id;
  END IF;

  -- Novidade para o outro lado; quem escreveu já está em dia.
  IF v_sou_autor THEN
    UPDATE ops.chamados
       SET respondentes_lido_em = NULL,
           autor_lido_em = now(),
           updated_at = now()
     WHERE id = v_chamado.id;
  ELSE
    UPDATE ops.chamados
       SET autor_lido_em = NULL,
           respondentes_lido_em = now(),
           updated_at = now()
     WHERE id = v_chamado.id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_chamado.id,
    'mensagem_id', v_mensagem_id,
    'status', COALESCE(v_status, v_chamado.status),
    'mudou_status', v_mudou_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.responder_chamado(uuid, uuid, text, text, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 11. RPC contar_chamados_pendentes(p_user_id) → int (badge do inbox)
--     Quem responde: chamados abertos dos outros com respondentes_lido_em null.
--     Qualquer um: os próprios chamados com autor_lido_em null. Sem duplicar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contar_chamados_pendentes(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'ops', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pode_responder boolean;
  v_total int;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN 0;
  END IF;

  v_pode_responder := ops.chamado_pode_responder(p_user_id);

  SELECT COUNT(*) INTO v_total
  FROM ops.chamados c
  WHERE c.tenant_id = v_tenant_id
    AND (
      (c.autor_id = p_user_id AND c.autor_lido_em IS NULL)
      OR (v_pode_responder
          AND c.autor_id <> p_user_id
          AND c.status IN ('recebido', 'em_analise')
          AND c.respondentes_lido_em IS NULL)
    );

  RETURN COALESCE(v_total, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.contar_chamados_pendentes(uuid) TO authenticated, service_role;
