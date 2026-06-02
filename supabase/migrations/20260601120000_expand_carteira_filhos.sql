-- Permite expandir filhos de uma matriz de carteira existente a partir de um
-- array de processos (saída do parser CSV). Idempotente: usa `identificador`
-- como chave única e pula filhos que já existem.
--
-- Motivação: hoje a RPC `update_caso` NÃO expande filhos quando o CSV é
-- enviado em uma matriz já criada — só `create_caso` faz isso (LOOP linhas
-- 301-329 da migration 20260430120000). Resultado: Filipe re-sobe CSV em
-- carteira existente e nada acontece além do JSON do pai ser sobrescrito.
--
-- Esta RPC é chamada pelo frontend (caso-form.tsx) APÓS o submit normal
-- da edge update-caso, quando: (a) é matriz (parte_de_carteira_id IS NULL,
-- regra_cobranca = 'mensalidade_carteira') e (b) o payload tem
-- regras.processos_carteira com pelo menos 1 item.

CREATE OR REPLACE FUNCTION public.expand_carteira_filhos(
  p_user_id uuid,
  p_matriz_id uuid,
  p_processos jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_count_novos integer := 0;
  v_count_skipped integer := 0;
  v_processo jsonb;
  v_identificador text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos
    WHERE id = p_matriz_id
      AND tenant_id = v_tenant_id
      AND regra_cobranca = 'mensalidade_carteira'
      AND parte_de_carteira_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Caso não é matriz de carteira válida';
  END IF;

  IF p_processos IS NULL OR jsonb_typeof(p_processos) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'p_processos deve ser array jsonb');
  END IF;

  FOR v_processo IN SELECT value FROM jsonb_array_elements(p_processos)
  LOOP
    v_identificador := NULLIF(v_processo->>'identificador', '');
    IF v_identificador IS NULL THEN
      CONTINUE;
    END IF;

    -- Idempotência: pula se já existe filho com este identificador na matriz
    IF EXISTS (
      SELECT 1 FROM contracts.casos f
      WHERE f.parte_de_carteira_id = p_matriz_id
        AND f.tenant_id = v_tenant_id
        AND COALESCE(NULLIF(f.regra_cobranca_config->>'identificador', ''), f.nome) = v_identificador
    ) THEN
      v_count_skipped := v_count_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO contracts.casos (
      tenant_id, contrato_id, parte_de_carteira_id, nome, observacao, servico_id, produto_id, responsavel_id,
      moeda, tipo_cobranca_documento, data_inicio_faturamento, dia_inicio_faturamento,
      polo, pagamento_dia_mes, inicio_vigencia, periodo_reajuste,
      data_proximo_reajuste, data_ultimo_reajuste, indice_reajuste,
      regra_cobranca, regra_cobranca_config, regras_financeiras,
      centro_custo_rateio, pagadores_servico, despesas_config, pagadores_despesa,
      timesheet_config, indicacao_config, status, ativo, created_by, updated_by
    )
    SELECT
      m.tenant_id, m.contrato_id, m.id,
      v_identificador,
      NULLIF(v_processo->>'numero_processo', ''),
      m.servico_id, m.produto_id, m.responsavel_id,
      m.moeda, m.tipo_cobranca_documento, m.data_inicio_faturamento, m.dia_inicio_faturamento,
      m.polo, m.pagamento_dia_mes, m.inicio_vigencia, m.periodo_reajuste,
      m.data_proximo_reajuste, m.data_ultimo_reajuste, m.indice_reajuste,
      'mensalidade_carteira',
      jsonb_build_object(
        'numero_processo', v_processo->>'numero_processo',
        'identificador', v_identificador
      ),
      '[]'::jsonb,
      m.centro_custo_rateio, m.pagadores_servico, m.despesas_config, m.pagadores_despesa,
      m.timesheet_config, m.indicacao_config, m.status, m.ativo, p_user_id, p_user_id
    FROM contracts.casos m WHERE m.id = p_matriz_id;

    v_count_novos := v_count_novos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'novos_filhos', v_count_novos,
    'skipped', v_count_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.expand_carteira_filhos(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expand_carteira_filhos(uuid, uuid, jsonb) TO service_role;
