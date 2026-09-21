-- =====================================================================
-- Mensalidade com teto de horas: so o excedente e cobrado
--
-- Filipe, 21/09, caso 314 (Velsis, "Consultoria - horas"): "ele e mensal
-- mas ta cobrando por hora tambem". A regra do caso e mensalidade de
-- R$ 5.366,55 com cap_enabled, cap_max = 15h, cobra_excedente = true e
-- valor_hora_excedente = 343,54. O sistema lia "cobra_excedente" como
-- "cobra toda hora" e precificava as 12h16 do mes a 535,66 (R$ 6.567,20 a
-- mais). O combinado e outro: ate 15h esta dentro da mensalidade (vale
-- zero); so o que passa do teto e cobrado, e pelo valor do excedente.
--
-- E o unico caso ativo da base com essa combinacao hoje.
--
-- Como fica:
--  1. resolver_valor_hora devolve NULL para mensalidade com teto + excedente
--     ("regra sem preco por hora"): a tela mantem o valor gravado em vez de
--     recalcular linha a linha, porque o teto e uma conta do periodo inteiro,
--     nao de cada lancamento.
--  2. finance.aplicar_teto_horas(caso) reprecifica os itens nao faturados do
--     caso, periodo a periodo, em ordem de data: acumula horas, zera o que
--     cabe no teto e cobra o excedente (inclusive o lancamento que cruza o
--     teto, so pela parte que passa).
--  3. Roda ao mudar a regra do caso (junto do recalculo que ja existia) e ao
--     nascerem itens de hora (gerador / liberacao), por gatilho de statement.
-- =====================================================================

-- 1. resolver_valor_hora: teto + excedente => sem preco por hora
CREATE OR REPLACE FUNCTION public.resolver_valor_hora(p_caso_id uuid, p_cargo_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH r AS (
    SELECT
      CASE
        WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
             AND jsonb_array_length(cs.regras_financeiras) > 0
          THEN cs.regras_financeiras->0
        ELSE NULL
      END AS x,
      cs.regra_cobranca,
      cs.regra_cobranca_config
    FROM contracts.casos cs
    WHERE cs.id = p_caso_id
  ),
  cfg AS (
    SELECT
      COALESCE(NULLIF(r.x->>'regra_cobranca', ''), r.regra_cobranca, '') AS regra,
      COALESCE(r.x->'regra_cobranca_config', r.regra_cobranca_config, '{}'::jsonb) AS c
    FROM r
  )
  SELECT CASE
    -- Mensalidade com teto de horas e excedente: o preco por hora nao e
    -- por linha, e do periodo (finance.aplicar_teto_horas). NULL = mantem
    -- o valor gravado.
    WHEN (SELECT regra FROM cfg) IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     AND COALESCE(((SELECT c FROM cfg)->>'cobra_excedente')::boolean, false)
     AND COALESCE(((SELECT c FROM cfg)->>'cap_enabled')::boolean, false)
     AND COALESCE(NULLIF((SELECT c FROM cfg)->>'cap_max', '')::numeric, 0) > 0
    THEN NULL
    -- Regra mensal sem excedente: a hora e registro de trabalho, nao cobranca.
    WHEN (SELECT regra FROM cfg) IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     AND COALESCE(((SELECT c FROM cfg)->>'cobra_excedente')::boolean, false) = false
    THEN 0
    ELSE COALESCE(
      (
        SELECT NULLIF(i->>'valor_hora', '')::numeric
        FROM cfg, LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(cfg.c->'tabela_preco_itens') = 'array'
                    THEN cfg.c->'tabela_preco_itens' ELSE '[]'::jsonb END
             ) i
        WHERE p_cargo_id IS NOT NULL
          AND i->>'cargo_id' = p_cargo_id::text
          AND COALESCE(NULLIF(i->>'valor_hora', '')::numeric, 0) > 0
        LIMIT 1
      ),
      (SELECT NULLIF(cfg.c->>'valor_hora', '')::numeric FROM cfg)
    )
  END;
$$;

-- 2. Teto por periodo
CREATE OR REPLACE FUNCTION finance.aplicar_teto_horas(p_caso_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'public'
AS $$
DECLARE
  v_regra text;
  v_cfg jsonb;
  v_cap numeric;
  v_vh_exc numeric;
  v_n integer := 0;
BEGIN
  SELECT
    COALESCE(NULLIF(cs.regras_financeiras->0->>'regra_cobranca', ''), cs.regra_cobranca, ''),
    COALESCE(cs.regras_financeiras->0->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb)
    INTO v_regra, v_cfg
  FROM contracts.casos cs WHERE cs.id = p_caso_id;

  IF v_regra IS NULL
     OR v_regra NOT IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     OR NOT COALESCE((v_cfg->>'cobra_excedente')::boolean, false)
     OR NOT COALESCE((v_cfg->>'cap_enabled')::boolean, false)
  THEN
    RETURN 0;
  END IF;

  v_cap := COALESCE(NULLIF(v_cfg->>'cap_max', '')::numeric, 0);
  -- Sem valor de excedente cadastrado, cai no valor/hora do caso.
  v_vh_exc := COALESCE(NULLIF(v_cfg->>'valor_hora_excedente', '')::numeric,
                       NULLIF(v_cfg->>'valor_hora', '')::numeric, 0);
  IF v_cap <= 0 THEN RETURN 0; END IF;

  -- Horas acumuladas por periodo, em ordem de data; o que passa do teto e
  -- cobrado pela parte que passa.
  WITH itens AS (
    SELECT bi.id, bi.periodo_inicio, bi.periodo_fim,
           COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0) AS horas,
           SUM(COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0))
             OVER (PARTITION BY bi.periodo_inicio, bi.periodo_fim
                   ORDER BY bi.data_referencia, bi.created_at, bi.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM finance.billing_items bi
    WHERE bi.caso_id = p_caso_id
      AND bi.origem_tipo = 'timesheet'
      AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado')
  ),
  calc AS (
    SELECT id, horas,
           GREATEST(0, LEAST(horas, acumulado - v_cap)) AS horas_excedentes
    FROM itens
  )
  UPDATE finance.billing_items bi
     SET valor_informado = ROUND(c.horas_excedentes * v_vh_exc, 2),
         valor_revisado  = CASE WHEN bi.horas_revisadas IS NULL THEN bi.valor_revisado
                                ELSE ROUND(c.horas_excedentes * v_vh_exc, 2) END,
         valor_aprovado  = CASE WHEN bi.horas_aprovadas IS NULL THEN bi.valor_aprovado
                                ELSE ROUND(c.horas_excedentes * v_vh_exc, 2) END,
         -- valor_hora efetivo da linha: 0 dentro do teto, excedente fora.
         snapshot = jsonb_set(
           COALESCE(bi.snapshot, '{}'::jsonb), '{valor_hora}',
           to_jsonb(CASE WHEN c.horas_excedentes > 0 THEN v_vh_exc ELSE 0 END)),
         updated_at = now()
    FROM calc c
   WHERE bi.id = c.id
     AND (
       COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)
         <> ROUND(c.horas_excedentes * v_vh_exc, 2)
       OR COALESCE(NULLIF(bi.snapshot->>'valor_hora', '')::numeric, -1)
         <> CASE WHEN c.horas_excedentes > 0 THEN v_vh_exc ELSE 0 END
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- 3a. Ao mudar a regra do caso, o recalculo existente chama o teto em seguida.
CREATE OR REPLACE FUNCTION contracts.trg_caso_regra_recalcula_itens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'contracts', 'finance', 'public'
AS $$
BEGIN
  PERFORM finance.recalcular_valores_hora_do_caso(NEW.id);
  PERFORM finance.aplicar_teto_horas(NEW.id);
  RETURN NEW;
END $$;

-- 3b. Ao nascerem itens de hora (gerador, liberacao), aplica o teto nos
--     casos envolvidos. Statement-level com tabela de transicao: uma
--     chamada por caso, nao por linha.
CREATE OR REPLACE FUNCTION finance.trg_itens_novos_aplicam_teto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'public'
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT caso_id FROM novos WHERE origem_tipo = 'timesheet' AND caso_id IS NOT NULL
  LOOP
    PERFORM finance.aplicar_teto_horas(r.caso_id);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_itens_novos_aplicam_teto ON finance.billing_items;
CREATE TRIGGER trg_itens_novos_aplicam_teto
AFTER INSERT ON finance.billing_items
REFERENCING NEW TABLE AS novos
FOR EACH STATEMENT
EXECUTE FUNCTION finance.trg_itens_novos_aplicam_teto();

-- 4. Acerto do caso 314 (e de qualquer outro na mesma situacao).
DO $$
DECLARE r record; v_total int := 0;
BEGIN
  FOR r IN
    SELECT cs.id FROM contracts.casos cs
    WHERE COALESCE(NULLIF(cs.regras_financeiras->0->>'regra_cobranca',''), cs.regra_cobranca)
            IN ('mensal','mensalidade_processo','mensalidade_carteira','salario_minimo')
      AND COALESCE((COALESCE(cs.regras_financeiras->0->'regra_cobranca_config', cs.regra_cobranca_config)->>'cobra_excedente')::boolean, false)
      AND COALESCE((COALESCE(cs.regras_financeiras->0->'regra_cobranca_config', cs.regra_cobranca_config)->>'cap_enabled')::boolean, false)
  LOOP
    v_total := v_total + finance.aplicar_teto_horas(r.id);
  END LOOP;
  RAISE NOTICE 'itens reprecificados pelo teto: %', v_total;
END $$;
