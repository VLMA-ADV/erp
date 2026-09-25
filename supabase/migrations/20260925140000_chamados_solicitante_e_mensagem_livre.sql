-- Chamados com "Solicitante" e mensagem avulsa "livre" (Filipe, 24/09/2026).
--
-- D1. Quem abre o chamado nem sempre é quem pediu: a secretária abre em nome
--     do sócio, o coordenador registra o que a equipe reclamou. Entra o campo
--     "Solicitante" (colaborador do VLMA, padrão = quem está logado), gravado
--     em ops.chamados.solicitante_colaborador_id. A lista e o detalhe mostram
--     "aberto por X · solicitante Y" quando são pessoas diferentes.
--
-- D2. Mensagem avulsa sem cliente nem caso ("mensagem livre"): o recado nem
--     sempre é sobre um cliente. Cliente e caso viram opcionais; a exceção
--     "Selecione ao menos um vínculo" sai do RPC e a listagem mostra
--     "Mensagem livre" no lugar do vínculo. A mensagem também ganha
--     "Solicitante / Em nome de" (opcional), mesmo select de colaboradores.
--
-- Migração aditiva: 2 colunas novas, 1 RPC nova (lista de colaboradores para
-- o select, sem salário/e-mail — a edge list-colaboradores devolve a ficha
-- inteira e não traz user_id, que é o que amarra o padrão "eu"), e CREATE OR
-- REPLACE das 5 RPCs existentes com a MESMA assinatura. A única remoção é o
-- CHECK solicitacao_mensagens_vinculo_chk (solicitacao OR caso OR cliente),
-- que é exatamente a regra que o Filipe pediu para derrubar.

-- ---------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------
ALTER TABLE ops.chamados
  ADD COLUMN IF NOT EXISTS solicitante_colaborador_id uuid
    REFERENCES people.colaboradores(id) ON DELETE SET NULL;

ALTER TABLE contracts.solicitacao_mensagens
  ADD COLUMN IF NOT EXISTS solicitante_colaborador_id uuid
    REFERENCES people.colaboradores(id) ON DELETE SET NULL;

-- Mensagem livre: o vínculo deixa de ser obrigatório (D2).
ALTER TABLE contracts.solicitacao_mensagens
  DROP CONSTRAINT IF EXISTS solicitacao_mensagens_vinculo_chk;

-- ---------------------------------------------------------------------
-- 2. RPC listar_colaboradores_para_selecao(p_user_id)
--    → {eu_colaborador_id, itens:[{id, nome, user_id}]}
--    Colaboradores ativos do tenant, só id/nome/user_id: é o que um select
--    precisa. Qualquer logado do tenant pode chamar (abrir chamado e mandar
--    mensagem não exigem permissão).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.listar_colaboradores_para_selecao(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_eu uuid;
  v_itens jsonb;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT c.id INTO v_eu
  FROM people.colaboradores c
  WHERE c.tenant_id = v_tenant_id AND c.user_id = p_user_id
  LIMIT 1;

  -- Inclui o próprio usuário mesmo se estiver marcado inativo: senão o
  -- padrão do select apontaria para alguém fora da lista.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'nome', c.nome,
    'user_id', c.user_id
  ) ORDER BY c.nome), '[]'::jsonb)
  INTO v_itens
  FROM people.colaboradores c
  WHERE c.tenant_id = v_tenant_id
    AND (COALESCE(c.ativo, true) OR c.id = v_eu);

  RETURN jsonb_build_object('eu_colaborador_id', v_eu, 'itens', v_itens);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.listar_colaboradores_para_selecao(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Helpers internos
-- ---------------------------------------------------------------------
-- Solicitante como o front espera: {id, nome, user_id} (user_id para comparar
-- com o autor sem depender do nome).
CREATE OR REPLACE FUNCTION ops.chamado_solicitante(p_tenant_id uuid, p_colaborador_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $function$
  SELECT CASE WHEN p_colaborador_id IS NULL THEN NULL ELSE
    (SELECT jsonb_build_object('id', c.id, 'nome', c.nome, 'user_id', c.user_id)
     FROM people.colaboradores c
     WHERE c.id = p_colaborador_id AND c.tenant_id = p_tenant_id
     LIMIT 1)
  END;
$function$;

-- Valida o colaborador informado como solicitante (tem que ser do tenant).
-- Devolve NULL para vazio/ausente.
CREATE OR REPLACE FUNCTION ops.chamado_validar_solicitante(p_tenant_id uuid, p_valor text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'people'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  v_id := NULLIF(trim(COALESCE(p_valor, '')), '')::uuid;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM people.colaboradores c WHERE c.id = v_id AND c.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Solicitante não encontrado';
  END IF;
  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. criar_chamado: payload ganha solicitante_colaborador_id (opcional).
--    Sem ele, o solicitante fica NULL = o próprio autor.
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
  v_solicitante uuid;
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
  -- Solicitante (Filipe 24/09): quem pediu, quando não é quem está abrindo.
  v_solicitante := ops.chamado_validar_solicitante(v_tenant_id, p_payload->>'solicitante_colaborador_id');

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
    status, rota, autor_id, autor_lido_em, respondentes_lido_em, solicitante_colaborador_id
  ) VALUES (
    v_id, v_tenant_id, v_numero, v_categoria, v_modulo, v_titulo, v_descricao, v_urgencia,
    'recebido', v_rota, p_user_id, now(), NULL, v_solicitante
  );

  PERFORM ops.chamado_gravar_anexos(v_tenant_id, v_id, NULL, p_user_id, p_payload->'anexos');

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero);
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. listar_chamados: cada item ganha 'solicitante' ({id, nome, user_id} | null).
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
        'solicitante', ops.chamado_solicitante(v_tenant_id, c.solicitante_colaborador_id),
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

-- ---------------------------------------------------------------------
-- 6. obter_chamado: devolve 'solicitante' ({id, nome, user_id} | null).
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
    'solicitante', ops.chamado_solicitante(v_tenant_id, v_chamado.solicitante_colaborador_id),
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

-- ---------------------------------------------------------------------
-- 7. create_mensagem_avulsa: cliente/caso opcionais (mensagem livre) e
--    solicitante_colaborador_id opcional no payload.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_mensagem_avulsa(p_user_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_colaborador_id uuid;
  v_cliente_id uuid;
  v_caso_id uuid;
  v_solicitante_id uuid;
  v_mensagem text;
  v_id uuid;
  v_anexo jsonb;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT c.id INTO v_colaborador_id
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id
    AND c.tenant_id = v_tenant_id
  LIMIT 1;

  IF v_colaborador_id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado para o usuário';
  END IF;

  v_cliente_id := NULLIF(p_payload->>'cliente_id', '')::uuid;
  v_caso_id := NULLIF(p_payload->>'caso_id', '')::uuid;
  v_solicitante_id := NULLIF(p_payload->>'solicitante_colaborador_id', '')::uuid;
  v_mensagem := COALESCE(NULLIF(trim(p_payload->>'mensagem'), ''), '');

  IF v_mensagem = '' THEN
    RAISE EXCEPTION 'Mensagem é obrigatória';
  END IF;

  -- Mensagem livre (Filipe 24/09): cliente e caso são opcionais. A antiga
  -- exceção "Selecione ao menos um vínculo" saiu daqui de propósito.

  IF v_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.clientes WHERE id = v_cliente_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  IF v_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos WHERE id = v_caso_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  IF v_solicitante_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM people.colaboradores WHERE id = v_solicitante_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Solicitante não encontrado';
  END IF;

  INSERT INTO contracts.solicitacao_mensagens (
    solicitacao_id,
    cliente_id,
    caso_id,
    autor_id,
    mensagem,
    tenant_id,
    solicitante_colaborador_id
  ) VALUES (
    NULL,
    v_cliente_id,
    v_caso_id,
    v_colaborador_id,
    v_mensagem,
    v_tenant_id,
    v_solicitante_id
  ) RETURNING id INTO v_id;

  IF jsonb_typeof(p_payload->'anexos') = 'array' THEN
    FOR v_anexo IN SELECT value FROM jsonb_array_elements(p_payload->'anexos')
    LOOP
      IF NULLIF(v_anexo->>'arquivo_base64', '') IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO contracts.solicitacao_mensagens_anexos (
        tenant_id,
        mensagem_id,
        nome,
        arquivo_nome,
        mime_type,
        tamanho_bytes,
        arquivo,
        created_by
      ) VALUES (
        v_tenant_id,
        v_id,
        COALESCE(NULLIF(trim(v_anexo->>'nome'), ''),
                 NULLIF(v_anexo->>'arquivo_nome', ''),
                 'Anexo'),
        COALESCE(NULLIF(v_anexo->>'arquivo_nome', ''), 'anexo.bin'),
        NULLIF(v_anexo->>'mime_type', ''),
        NULLIF(v_anexo->>'tamanho_bytes', '')::bigint,
        decode(v_anexo->>'arquivo_base64', 'base64'),
        p_user_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'tenant_id', v_tenant_id,
    'cliente_id', v_cliente_id,
    'caso_id', v_caso_id,
    'autor_id', v_colaborador_id,
    'solicitante_colaborador_id', v_solicitante_id
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- 8. list_mensagens_avulsas_inbox: já era LEFT JOIN em cliente/caso (aguenta
--    nulos); ganha solicitante_id / solicitante_nome.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_mensagens_avulsas_inbox(p_user_id uuid, p_limit integer DEFAULT 5, p_only_unread boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'id', m.id,
        'mensagem', m.mensagem,
        'created_at', m.created_at,
        'cliente_id', m.cliente_id,
        'caso_id', m.caso_id,
        'autor_id', m.autor_id,
        'cliente_nome', cl.nome,
        'caso_nome', cs.nome,
        'autor_nome', col.nome,
        -- Foto de quem escreveu: o Filipe pediu que a caixa de entrada pareca
        -- um chat, e chat sem rosto nao parece chat (07/08).
        'autor_foto', col.foto_url,
        'lido_at', m.lido_at,
        -- "Em nome de" (24/09): quem pediu o recado, quando não é quem escreveu.
        'solicitante_id', m.solicitante_colaborador_id,
        'solicitante_nome', sol.nome
      ) AS row_data,
      m.created_at
    FROM contracts.solicitacao_mensagens m
    LEFT JOIN crm.clientes cl ON cl.id = m.cliente_id
    LEFT JOIN contracts.casos cs ON cs.id = m.caso_id
    LEFT JOIN people.colaboradores col ON col.id = m.autor_id
    LEFT JOIN people.colaboradores sol ON sol.id = m.solicitante_colaborador_id
    WHERE m.tenant_id = v_tenant_id
      AND m.solicitacao_id IS NULL
      AND (NOT p_only_unread OR m.lido_at IS NULL)
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ) sub;

  RETURN v_result;
END;
$function$;
