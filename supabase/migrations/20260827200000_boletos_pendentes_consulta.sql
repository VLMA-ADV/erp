-- =====================================================================
-- Lista os boletos que valem uma consulta ao Itau (para a baixa diaria)
--
-- A rota do cron tentou ler finance.boletos direto pelo PostgREST e tomou
-- "permission denied for table boletos": o schema finance nao e exposto, como
-- operations tambem nao e. Todo acesso passa por RPC em public — e aqui isso e
-- proposital, nao obstaculo: a funcao ja devolve o boleto JUNTO com o
-- id_beneficiario e a carteira do tenant dele, que e exatamente o que a consulta
-- precisa, numa viagem so.
--
-- Sem p_user_id de proposito: quem chama e o cron, com service_role, e nao ha
-- pessoa logada. Por isso o GRANT abaixo e so para service_role — 'authenticated'
-- nao recebe, senao qualquer usuario logado leria a carteira de cobranca.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bol_pendentes_para_consulta(p_limite int DEFAULT 300)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance'
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'vencimento'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'boleto_id',       b.id,
      'nosso_numero',    b.nosso_numero,
      'valor',           b.valor,
      'vencimento',      b.vencimento,
      'id_beneficiario', c.id_beneficiario,
      'codigo_carteira', COALESCE(c.codigo_carteira, '109')
    ) AS x
    FROM finance.boletos b
    JOIN finance.boleto_config c ON c.tenant_id = b.tenant_id
    WHERE b.status IN ('registrado', 'aberto')
      AND COALESCE(c.id_beneficiario, '') <> ''
    LIMIT p_limite
  ) t;
$$;

REVOKE ALL ON FUNCTION public.bol_pendentes_para_consulta(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bol_pendentes_para_consulta(int) TO service_role;
