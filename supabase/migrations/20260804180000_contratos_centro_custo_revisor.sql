-- Centro de custo e revisor na linha do caso (pedido Filipe 04/08).
-- Os dois vivem em jsonb; a função passa a resolver os nomes.

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
          -- Centro de custo e revisor na linha do caso (pedido Filipe 04/08).
          -- Ambos vivem em jsonb; resolvidos aqui para a tela não ter que juntar.
          'centro_custo_nome', (
            SELECT string_agg(a.nome || CASE WHEN (r->>'percentual')::numeric < 100
                                        THEN ' ' || (r->>'percentual') || '%' ELSE '' END, ' · ')
            FROM jsonb_array_elements(COALESCE(cs.centro_custo_rateio, '[]'::jsonb)) r
            JOIN people.areas a ON a.id = NULLIF(r->>'centro_custo_id','')::uuid
          ),
          'revisor_nome', (
            CASE WHEN cs.timesheet_config->>'revisores_modo' = 'auto_centro_custo'
              THEN 'Automático (centro de custo)'
              ELSE (
                SELECT string_agg(c2.nome, ' · ' ORDER BY (rv->>'ordem')::int)
                FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'revisores', '[]'::jsonb)) rv
                JOIN people.colaboradores c2 ON c2.id = NULLIF(rv->>'colaborador_id','')::uuid
              )
            END
          ),
          'status', cs.status,
          'ativo', (cs.status <> 'inativo'),
          'regra_cobranca', cs.regra_cobranca,
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
$function$
;
