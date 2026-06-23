-- CRM: minidashboard + temperatura de fechamento (configurável pelo usuário).
-- Tudo via RPC (schema crm não é exposto ao PostgREST).

-- ── Temperatura de fechamento (lista configurável por tenant) ───────────────
CREATE TABLE IF NOT EXISTS crm.temperaturas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  nome       varchar NOT NULL,
  ordem      integer NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_crm_temperaturas_tenant ON crm.temperaturas (tenant_id);
ALTER TABLE crm.temperaturas ENABLE ROW LEVEL SECURITY;

ALTER TABLE crm.pipeline_cards ADD COLUMN IF NOT EXISTS temperatura_id uuid REFERENCES crm.temperaturas(id) ON DELETE SET NULL;

-- Seed inicial (Quente/Morno/Frio) para tenants que ainda não têm nenhuma.
INSERT INTO crm.temperaturas (tenant_id, nome, ordem)
SELECT t.id, x.nome, x.ordem
FROM core.tenants t
CROSS JOIN (VALUES ('Quente', 1), ('Morno', 2), ('Frio', 3)) AS x(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM crm.temperaturas tp WHERE tp.tenant_id = t.id);

-- ── get_crm_dashboard: resumo das oportunidades (cards ativos) ──────────────
CREATE OR REPLACE FUNCTION public.get_crm_dashboard(p_user_id uuid)
 RETURNS jsonb
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

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo),
    'valor_total', (SELECT COALESCE(sum(valor), 0) FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo),
    'por_fase', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', etapa, 'count', n, 'valor', v) ORDER BY n DESC)
      FROM (SELECT etapa, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY etapa) s
    ), '[]'::jsonb),
    'por_centro_custo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(ar.nome,'Sem centro de custo'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT area_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY area_id) s
      LEFT JOIN people.areas ar ON ar.id = s.area_id
    ), '[]'::jsonb),
    'por_produto', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(p.nome,'Sem produto'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT produto_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY produto_id) s
      LEFT JOIN contracts.produtos p ON p.id = s.produto_id
    ), '[]'::jsonb),
    'por_responsavel', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(col.nome,'Sem responsável'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT responsavel_interno_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY responsavel_interno_id) s
      LEFT JOIN people.colaboradores col ON col.id = s.responsavel_interno_id
    ), '[]'::jsonb),
    'por_temperatura', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(tp.nome,'Sem temperatura'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT temperatura_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY temperatura_id) s
      LEFT JOIN crm.temperaturas tp ON tp.id = s.temperatura_id
    ), '[]'::jsonb),
    'por_localidade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('uf', COALESCE(uf,'??'), 'count', n, 'valor', v) ORDER BY n DESC)
      FROM (
        SELECT cli.estado AS uf, count(*) n, COALESCE(sum(c.valor),0) v
        FROM crm.pipeline_cards c JOIN crm.clientes cli ON cli.id = c.cliente_id
        WHERE c.tenant_id = v_tenant_id AND c.ativo
        GROUP BY cli.estado
      ) s
    ), '[]'::jsonb),
    'por_segmento', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(seg.nome,'Sem segmento'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (
        SELECT se.segmento_id, count(*) n, COALESCE(sum(c.valor),0) v
        FROM crm.pipeline_cards c
        LEFT JOIN crm.clientes_segmentos se ON se.cliente_id = c.cliente_id
        WHERE c.tenant_id = v_tenant_id AND c.ativo
        GROUP BY se.segmento_id
      ) s
      LEFT JOIN crm.segmentos_economicos seg ON seg.id = s.segmento_id
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_crm_dashboard(uuid) TO authenticated, service_role;
