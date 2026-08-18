-- =====================================================================
-- Quem recebe o aviso de lote fechado
--
-- Filipe, 17/08: "O fechar o lote deve mandar aviso para o financeiro para
-- poder baixar".
--
-- A primeira versão desta função usou a permissão finance.contas_pagar.write,
-- que é o gate da tela de validar. Só que sócio e administrativo recebem TODAS
-- as permissões por categoria, então a lista deu 14 pessoas — os doze sócios,
-- a recepção e até a conta de teste automatizado. Aviso operacional para 14
-- caixas de entrada não é aviso, é spam, e em uma semana ninguém lê.
--
-- Quem dá baixa no lote é o administrativo (Jessika e Fabiano). É para eles
-- que o e-mail vai.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_emails_financeiro(p_tenant_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT u.email ORDER BY u.email), ARRAY[]::text[])
  FROM people.colaboradores c
  JOIN auth.users u ON u.id = c.user_id
  WHERE c.tenant_id = p_tenant_id
    AND c.ativo
    AND c.categoria::text = 'administrativo'
    AND u.email IS NOT NULL
    -- Conta de teste não recebe e-mail de verdade.
    AND u.email NOT LIKE '%@local.dev';
$function$;

REVOKE ALL ON FUNCTION public.get_emails_financeiro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_emails_financeiro(uuid) TO service_role;
