-- "Cliente novo no ano" (resposta 3 do cliente: critério b + ajuste manual).
-- Novo = ano do PRIMEIRO contrato do cliente; ano_captacao_override permite
-- corrigir manualmente (recadastros/migração).
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS ano_captacao_override integer;

CREATE OR REPLACE FUNCTION public.get_clientes_novos_ano(p_ano integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'crm', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN (
    WITH base AS (
      SELECT cli.id, cli.nome,
        COALESCE(
          cli.ano_captacao_override,
          (SELECT extract(year FROM min(ct.created_at::date))::int
             FROM contracts.contratos ct WHERE ct.cliente_id = cli.id AND ct.tenant_id = v_tenant)
        ) AS ano_captacao,
        (cli.ano_captacao_override IS NOT NULL) AS ajustado
      FROM crm.clientes cli
      WHERE cli.tenant_id = v_tenant
    )
    SELECT jsonb_build_object(
      'ano', p_ano,
      'total', (SELECT count(*) FROM base WHERE ano_captacao = p_ano),
      'clientes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ajustado', ajustado) ORDER BY nome)
        FROM base WHERE ano_captacao = p_ano
      ), '[]'::jsonb),
      'por_ano', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('ano', ano_captacao, 'total', n) ORDER BY ano_captacao DESC)
        FROM (SELECT ano_captacao, count(*) n FROM base WHERE ano_captacao IS NOT NULL GROUP BY 1) x
      ), '[]'::jsonb)
    )
  );
END;
$function$;
