-- Fase de segurança — idempotência da emissão de NFS-e.
--
-- Problema: emit-nfse lê os itens 'aprovado', aloca numero_dps, chama a Focus e
-- grava a nota — mas NUNCA muda o status dos itens. Uma segunda chamada relê os
-- mesmos itens e emite de novo (cliente cobrado 2x; itens nunca "faturados").
--
-- Correção em duas camadas:
--   1) Após sucesso, os itens viram 'faturado' → get_billing_items_aprovados_full
--      passa a devolver vazio → re-emissão sequencial cai no 404 já existente.
--   2) Clique-duplo SIMULTÂNEO: as duas requisições leem 'aprovado' antes de
--      qualquer escrita. O claim atômico abaixo serializa via lock de linha:
--      a 1ª flipa aprovado→faturado; a 2ª encontra 0 itens 'aprovado' e recebe 0,
--      abortando ANTES de alocar DPS/chamar a Focus.
--
-- Em caso de recusa da Focus, o edge reverte o claim (faturado→aprovado) para
-- permitir nova tentativa.

-- Claim atômico: só flipa se TODOS os item_ids ainda estiverem 'aprovado'
-- (all-or-nothing). Retorna a quantidade efetivamente reservada.
CREATE OR REPLACE FUNCTION public.claim_itens_faturamento(
  p_user_id   uuid,
  p_tenant_id uuid,
  p_item_ids  uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total    integer := COALESCE(array_length(p_item_ids, 1), 0);
  v_aprovado integer;
  v_claimed  integer;
BEGIN
  IF v_total = 0 THEN
    RETURN 0;
  END IF;

  -- Trava TODAS as linhas alvo (qualquer status). O FOR UPDATE serializa cliques
  -- concorrentes: a 2ª transação espera a 1ª liberar e só então lê o status já
  -- atualizado. Locka antes de contar para garantir o all-or-nothing sob corrida.
  PERFORM 1
  FROM finance.billing_items bi
  WHERE bi.tenant_id = p_tenant_id
    AND bi.id = ANY(p_item_ids)
  FOR UPDATE;

  -- Já com o lock, conta quantas ainda estão 'aprovado'.
  SELECT count(*) INTO v_aprovado
  FROM finance.billing_items bi
  WHERE bi.tenant_id = p_tenant_id
    AND bi.id = ANY(p_item_ids)
    AND bi.status = 'aprovado';

  -- All-or-nothing: se algum item já saiu de 'aprovado', não reserva nada.
  IF v_aprovado <> v_total THEN
    RETURN 0;
  END IF;

  UPDATE finance.billing_items bi
  SET status = 'faturado', updated_at = now(), updated_by = p_user_id
  WHERE bi.tenant_id = p_tenant_id
    AND bi.id = ANY(p_item_ids)
    AND bi.status = 'aprovado';

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed;
END;
$function$;

-- Compensação: usada pelo edge quando a Focus recusa a emissão.
CREATE OR REPLACE FUNCTION public.reverter_itens_faturamento(
  p_user_id   uuid,
  p_tenant_id uuid,
  p_item_ids  uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reverted integer;
BEGIN
  IF COALESCE(array_length(p_item_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE finance.billing_items bi
  SET status = 'aprovado', updated_at = now(), updated_by = p_user_id
  WHERE bi.tenant_id = p_tenant_id
    AND bi.id = ANY(p_item_ids)
    AND bi.status = 'faturado';

  GET DIAGNOSTICS v_reverted = ROW_COUNT;
  RETURN v_reverted;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_itens_faturamento(uuid, uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.reverter_itens_faturamento(uuid, uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_itens_faturamento(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverter_itens_faturamento(uuid, uuid, uuid[]) TO service_role;
