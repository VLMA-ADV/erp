-- get_contratos (listagem) não retornava parte_de_carteira_id nem
-- processos_carteira_count nos casos. O frontend (contratos-list.tsx, PR #123)
-- depende desses campos para: (1) mostrar nome completo do filho, (2) esconder
-- a matriz da lista. Sem eles, a matriz aparece e os nomes saem como "numero - nome".
--
-- Esta migration recria get_contratos adicionando os 2 campos no jsonb dos casos.
-- Corpo preservado bit-a-bit do deployado, exceto os 2 campos novos.

CREATE OR REPLACE FUNCTION public.get_contratos(p_user_id uuid)
 RETURNS TABLE(id uuid, numero bigint, cliente_id uuid, cliente_nome character varying, nome_contrato character varying, regime_fiscal character varying, status character varying, created_at timestamp with time zone, casos jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.numero,
    c.cliente_id,
    cli.nome,
    c.nome_contrato,
    c.regime_fiscal,
    c.status,
    c.created_at,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', cs.id,
          'numero', cs.numero,
          'nome', cs.nome,
          'servico_id', cs.servico_id,
          'servico_nome', srv.nome,
          'produto_id', cs.produto_id,
          'produto_nome', p.nome,
          'responsavel_id', cs.responsavel_id,
          'responsavel_nome', col.nome,
          'status', cs.status,
          'ativo', (cs.status <> 'inativo'),
          'regras_financeiras', COALESCE(cs.regras_financeiras, '[]'::jsonb),
          'created_at', cs.created_at,
          'parte_de_carteira_id', cs.parte_de_carteira_id,
          'processos_carteira_count', (
            SELECT COUNT(*) FROM contracts.casos f
            WHERE f.parte_de_carteira_id = cs.id
          )
        ) ORDER BY cs.numero ASC NULLS LAST, cs.created_at DESC
      )
      FROM contracts.casos cs
      LEFT JOIN operations.categorias_servico srv ON srv.id = cs.servico_id
      LEFT JOIN contracts.produtos p ON p.id = cs.produto_id
      LEFT JOIN people.colaboradores col ON col.id = cs.responsavel_id
      WHERE cs.contrato_id = c.id
    ), '[]'::jsonb) AS casos
  FROM contracts.contratos c
  JOIN crm.clientes cli ON cli.id = c.cliente_id
  WHERE c.tenant_id = v_tenant_id
  ORDER BY c.numero ASC NULLS LAST, c.created_at DESC;
END;
$function$;
