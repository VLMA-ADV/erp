-- Contratos / Solicitação — mensagens (Fase B):
-- * providência tomada (além do "lida" já existente em lido_at).
-- * visibilidade: usuário comum vê só as próprias mensagens; financeiro
--   (admin/sócio) vê todas e pode marcar lida/providência.

ALTER TABLE contracts.solicitacao_mensagens
  ADD COLUMN IF NOT EXISTS providencia_at timestamptz,
  ADD COLUMN IF NOT EXISTS providencia_by uuid;

-- ── Leitura com visibilidade + nome do autor + status ───────────────────────
CREATE OR REPLACE FUNCTION public.get_solicitacao_mensagens(p_user_id uuid, p_solicitacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_is_manager boolean;
  v_colab_id uuid;
  v_mensagens jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  v_is_manager := COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  -- autor_id referencia people.colaboradores.id; resolve o colaborador do usuário
  SELECT id INTO v_colab_id FROM people.colaboradores
  WHERE user_id = p_user_id AND tenant_id = v_tenant_id LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'mensagem', m.mensagem,
      'created_at', m.created_at,
      'autor_id', m.autor_id,
      'autor', CASE WHEN col.id IS NOT NULL THEN jsonb_build_object('id', col.id, 'nome_completo', col.nome) ELSE NULL END,
      'lido_at', m.lido_at,
      'providencia_at', m.providencia_at,
      'is_propria', (m.autor_id = v_colab_id)
    ) ORDER BY m.created_at ASC
  ), '[]'::jsonb)
  INTO v_mensagens
  FROM contracts.solicitacao_mensagens m
  LEFT JOIN people.colaboradores col ON col.id = m.autor_id
  WHERE m.solicitacao_id = p_solicitacao_id
    AND m.tenant_id = v_tenant_id
    AND (v_is_manager OR m.autor_id = v_colab_id);

  RETURN jsonb_build_object('can_manage', v_is_manager, 'mensagens', v_mensagens);
END;
$function$;

-- ── Marcar lida (financeiro) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_mensagem_lida(p_user_id uuid, p_mensagem_id uuid, p_lida boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false) THEN
    RAISE EXCEPTION 'Apenas o financeiro pode marcar mensagens';
  END IF;

  UPDATE contracts.solicitacao_mensagens
  SET lido_at = CASE WHEN p_lida THEN now() ELSE NULL END
  WHERE id = p_mensagem_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensagem não encontrada'; END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ── Marcar providência tomada (financeiro) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_mensagem_providencia(p_user_id uuid, p_mensagem_id uuid, p_tomada boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false) THEN
    RAISE EXCEPTION 'Apenas o financeiro pode marcar providência';
  END IF;

  UPDATE contracts.solicitacao_mensagens
  SET providencia_at = CASE WHEN p_tomada THEN now() ELSE NULL END,
      providencia_by = CASE WHEN p_tomada THEN p_user_id ELSE NULL END
  WHERE id = p_mensagem_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensagem não encontrada'; END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_solicitacao_mensagens(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_mensagem_lida(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_mensagem_providencia(uuid, uuid, boolean) TO authenticated, service_role;
