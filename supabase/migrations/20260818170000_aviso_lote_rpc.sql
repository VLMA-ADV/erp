-- =====================================================================
-- Dados do aviso de lote fechado numa RPC só
--
-- Achado testando ponta a ponta: a edge function de aviso devolvia
-- 404 "Lote não encontrado" com o lote existindo na tabela.
--
-- Causa: ela lia operations.despesa_lotes e people.colaboradores via
-- PostgREST (supabase.schema("operations").from(...)). Só que o PostgREST
-- deste projeto não expõe esses schemas — uma chamada direta em
-- /rest/v1/despesa_lotes com Accept-Profile: operations devolve 406. A leitura
-- falhava e o código traduzia "sem dados" para "lote não encontrado".
--
-- É o mesmo tropeço que já aconteceu com o schema finance antes. A saída que
-- não depende de configuração de gateway é a de sempre neste projeto: uma RPC
-- em public, SECURITY DEFINER, que já devolve tudo mastigado.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_aviso_lote_fechado(p_lote_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'people', 'core'
AS $function$
  SELECT jsonb_build_object(
    'id', l.id,
    'status', l.status,
    'valor', l.valor,
    'descricao', l.descricao,
    'dono_nome', COALESCE(c.nome, 'Um colaborador'),
    'destinatarios', public.get_emails_financeiro(l.tenant_id)
  )
  FROM operations.despesa_lotes l
  LEFT JOIN people.colaboradores c
    ON c.user_id = l.colaborador_user_id AND c.tenant_id = l.tenant_id
  WHERE l.id = p_lote_id;
$function$;

REVOKE ALL ON FUNCTION public.get_aviso_lote_fechado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_aviso_lote_fechado(uuid) TO service_role;
