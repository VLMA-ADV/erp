-- =====================================================================
-- POSTERGAR o que não é hora
--
-- Filipe, 17/08: "eu tentei postergar uma fatura mas parece que não funcionou
-- totalmente, não reagendou. Acho que precisamos ter uma aba de 'faturas
-- postergadas' pra visualizar isso".
--
-- O QUE ESTAVA ACONTECENDO: o Postergar só sabia adiar HORA. O botão filtra as
-- linhas do extrato por tipo 'timesheet' e chama postergar_timesheet, que grava
-- operations.timesheets.periodo_faturamento. Mensalidade, pró-labore, projeto e
-- parcela de projeto não são linhas de tabela nenhuma — são calculadas a partir
-- da regra do contrato a cada consulta — então não havia onde gravar que foram
-- adiadas, e elas ficavam para trás em silêncio.
--
-- Medido na fila de agosto/2026: de 237 casos, 157 só têm hora (funcionavam),
-- 37 são mistos (moviam as horas e deixavam o resto) e 43 não têm hora nenhuma
-- (o botão não fazia absolutamente nada) — R$ 178.467,84 parados.
--
-- A SOLUÇÃO é uma tabela de adiamentos. A chave é (origem_id, competência):
-- origem_id vem de finance.rule_origin_uuid(caso, regra:tipo:AAAAMM) e é
-- DETERMINÍSTICO — conferido chamando get_itens_a_faturar duas vezes e
-- comparando as 80 linhas não-timesheet, todas idênticas.
--
-- O adiamento guarda um SNAPSHOT de valor e descrição. Sem ele, a linha
-- adiada não teria como reaparecer no mês de destino: a regra do contrato só
-- gera linha para o mês corrente, e em outubro ninguém saberia que existia uma
-- mensalidade de agosto esperando.
-- =====================================================================

CREATE TABLE IF NOT EXISTS finance.faturamento_adiamentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  caso_id        uuid NOT NULL,
  origem_id      uuid NOT NULL,   -- id determinístico da linha do extrato
  item_tipo      text NOT NULL,   -- mensal | mensalidade_processo | projeto | projeto_parcela | exito
  competencia    date NOT NULL,   -- primeiro dia do mês de onde saiu
  periodo_novo   date NOT NULL,   -- primeiro dia do mês para onde vai
  valor          numeric(14,2) NOT NULL,
  descricao      text NOT NULL,
  data_referencia date,
  motivo         text,
  desfeito_em    timestamptz,
  desfeito_por   uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,

  CONSTRAINT adiamento_frente_chk CHECK (periodo_novo > competencia)
);

-- Um adiamento vivo por linha. Adiar duas vezes a mesma linha do mesmo mês
-- faria ela aparecer em dois meses de destino — o mesmo dinheiro cobrado duas
-- vezes. Readiar é desfazer e refazer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_adiamento_vivo
  ON finance.faturamento_adiamentos (tenant_id, origem_id, competencia)
  WHERE desfeito_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_adiamento_destino
  ON finance.faturamento_adiamentos (tenant_id, periodo_novo) WHERE desfeito_em IS NULL;

ALTER TABLE finance.faturamento_adiamentos ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- Adiar uma linha que não é hora
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.postergar_item_regra(
  p_user_id uuid,
  p_caso_id uuid,
  p_origem_id uuid,
  p_item_tipo text,
  p_competencia date,
  p_periodo date,
  p_valor numeric,
  p_descricao text,
  p_data_referencia date DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_comp date;
  v_novo date;
  v_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.write','finance.faturamento.manage',
                               'finance.faturamento.review','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para postergar lançamento';
  END IF;

  IF p_periodo IS NULL OR p_competencia IS NULL THEN
    RAISE EXCEPTION 'Competência e novo período são obrigatórios'; END IF;

  v_comp := date_trunc('month', p_competencia)::date;
  v_novo := date_trunc('month', p_periodo)::date;
  IF v_novo <= v_comp THEN
    RAISE EXCEPTION 'O novo período tem de ser depois da competência'; END IF;

  IF COALESCE(p_valor, 0) <= 0 THEN RAISE EXCEPTION 'Valor do item é obrigatório'; END IF;

  -- Já faturado não se adia: a nota saiu.
  IF EXISTS (
    SELECT 1 FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id AND bi.origem_id = p_origem_id AND bi.status = 'faturado'
  ) THEN
    RAISE EXCEPTION 'Item já faturado não pode ser postergado';
  END IF;

  -- Se já virou billing_item na revisão, ele sai da fatura atual — senão o
  -- mesmo item conta agora E de novo no mês de destino.
  UPDATE finance.billing_items
  SET status = 'cancelado', grupo_id = NULL, updated_at = now(), updated_by = p_user_id
  WHERE tenant_id = v_tenant_id AND origem_id = p_origem_id AND status NOT IN ('cancelado', 'faturado');

  INSERT INTO finance.faturamento_adiamentos (
    tenant_id, caso_id, origem_id, item_tipo, competencia, periodo_novo,
    valor, descricao, data_referencia, motivo, created_by
  ) VALUES (
    v_tenant_id, p_caso_id, p_origem_id, p_item_tipo, v_comp, v_novo,
    p_valor, COALESCE(NULLIF(p_descricao, ''), 'Item de faturamento'),
    COALESCE(p_data_referencia, v_comp), NULLIF(p_motivo, ''), p_user_id
  )
  ON CONFLICT (tenant_id, origem_id, competencia) WHERE desfeito_em IS NULL
  DO UPDATE SET periodo_novo = EXCLUDED.periodo_novo, motivo = EXCLUDED.motivo
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'origem_id', p_origem_id, 'periodo_novo', v_novo);
END;
$function$;

-- Desfazer: a linha volta a aparecer no mês de origem.
CREATE OR REPLACE FUNCTION public.desfazer_adiamento(p_user_id uuid, p_adiamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.write','finance.faturamento.manage',
                               'finance.faturamento.review','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  UPDATE finance.faturamento_adiamentos
  SET desfeito_em = now(), desfeito_por = p_user_id
  WHERE id = p_adiamento_id AND tenant_id = v_tenant_id AND desfeito_em IS NULL;

  IF NOT FOUND THEN RAISE EXCEPTION 'Adiamento não encontrado ou já desfeito'; END IF;
  RETURN jsonb_build_object('id', p_adiamento_id, 'desfeito', true);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- A aba "postergados": hora e regra na mesma lista
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_faturamento_postergados(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.periodo_novo, x.cliente_nome)
    FROM (
      -- 1. Itens de regra (mensalidade, projeto, parcela)
      SELECT a.id, 'regra'::text AS fonte, a.item_tipo, a.descricao, a.valor,
             a.competencia, a.periodo_novo, a.motivo,
             cs.numero AS caso_numero, cs.nome AS caso_nome,
             cl.nome AS cliente_nome, a.created_at
      FROM finance.faturamento_adiamentos a
      LEFT JOIN contracts.casos cs ON cs.id = a.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE a.tenant_id = v_tenant_id AND a.desfeito_em IS NULL

      UNION ALL

      -- 2. Horas adiadas — moram em outro lugar (periodo_faturamento do
      --    timesheet), mas para quem olha a tela são a mesma coisa.
      SELECT t.id, 'hora'::text, 'timesheet',
             COALESCE(NULLIF(t.descricao, ''), 'Horas') ,
             (t.horas * COALESCE(public.resolver_valor_hora(t.caso_id, t.cargo_id), 0))::numeric(14,2),
             date_trunc('month', t.data_lancamento)::date,
             t.periodo_faturamento,
             NULL,
             cs.numero, cs.nome, cl.nome, t.updated_at
      FROM operations.timesheets t
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id
        AND t.periodo_faturamento IS NOT NULL
        AND date_trunc('month', t.periodo_faturamento)::date > date_trunc('month', t.data_lancamento)::date
    ) x
  ), '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.postergar_item_regra(uuid, uuid, uuid, text, date, date, numeric, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.desfazer_adiamento(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_faturamento_postergados(uuid) TO authenticated, service_role;
