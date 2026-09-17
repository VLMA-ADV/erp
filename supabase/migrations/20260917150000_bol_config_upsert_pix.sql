-- =====================================================================
-- bol_config_upsert grava chave_pix e bolecode_ativo
--
-- Filipe, 17/09: "tentei salvar mas ele nao ta persistindo". A tela mandava
-- os dois campos, mas o upsert grava uma lista fixa de colunas
-- (20260814120000) e os novos (20260917100000) nao estavam nela — o
-- restante salvava e a chave Pix era descartada em silencio.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bol_config_upsert(p_user_id uuid, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage') THEN
    RAISE EXCEPTION 'Sem permissão para configurar cobrança'; END IF;

  INSERT INTO finance.boleto_config AS c (
    tenant_id, ativo, id_beneficiario, codigo_carteira, codigo_especie,
    nosso_numero_inicio, nosso_numero_fim,
    multa_tipo, multa_valor, multa_percentual, multa_dias,
    juros_ativo, juros_codigo_tipo, juros_percentual_mes, juros_dias,
    desconto_expresso,
    protesto_ativo, protesto_codigo_tipo, protesto_dias,
    negativacao_ativo, negativacao_codigo_tipo, negativacao_dias,
    dias_limite_pagamento, instrucoes, recebimento_divergente, forma_envio,
    chave_pix, bolecode_ativo
  )
  VALUES (
    v_tenant,
    COALESCE((p_config->>'ativo')::boolean, false),
    NULLIF(p_config->>'id_beneficiario', ''),
    COALESCE(NULLIF(p_config->>'codigo_carteira', ''), '109'),
    COALESCE(NULLIF(p_config->>'codigo_especie', ''), '01'),
    COALESCE((p_config->>'nosso_numero_inicio')::bigint, 1),
    COALESCE((p_config->>'nosso_numero_fim')::bigint, 99999999),
    COALESCE(NULLIF(p_config->>'multa_tipo', ''), 'isento'),
    (p_config->>'multa_valor')::numeric,
    (p_config->>'multa_percentual')::numeric,
    COALESCE((p_config->>'multa_dias')::integer, 1),
    COALESCE((p_config->>'juros_ativo')::boolean, false),
    COALESCE(NULLIF(p_config->>'juros_codigo_tipo', ''), '90'),
    (p_config->>'juros_percentual_mes')::numeric,
    COALESCE((p_config->>'juros_dias')::integer, 1),
    COALESCE((p_config->>'desconto_expresso')::boolean, false),
    COALESCE((p_config->>'protesto_ativo')::boolean, false),
    (p_config->>'protesto_codigo_tipo')::integer,
    (p_config->>'protesto_dias')::integer,
    COALESCE((p_config->>'negativacao_ativo')::boolean, false),
    (p_config->>'negativacao_codigo_tipo')::integer,
    (p_config->>'negativacao_dias')::integer,
    (p_config->>'dias_limite_pagamento')::integer,
    COALESCE(p_config->'instrucoes', '[]'::jsonb),
    -- Ausente = usa o padrão '01'; presente e vazio = desligado de propósito.
    -- (Passar NULL direto atropelaria o DEFAULT da coluna sem querer.)
    CASE WHEN p_config ? 'recebimento_divergente'
         THEN NULLIF(p_config->>'recebimento_divergente', '') ELSE '01' END,
    COALESCE(NULLIF(p_config->>'forma_envio', ''), 'escritorio'),
    NULLIF(p_config->>'chave_pix', ''),
    COALESCE((p_config->>'bolecode_ativo')::boolean, false)
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    ativo = EXCLUDED.ativo,
    id_beneficiario = EXCLUDED.id_beneficiario,
    codigo_carteira = EXCLUDED.codigo_carteira,
    codigo_especie = EXCLUDED.codigo_especie,
    nosso_numero_inicio = EXCLUDED.nosso_numero_inicio,
    nosso_numero_fim = EXCLUDED.nosso_numero_fim,
    multa_tipo = EXCLUDED.multa_tipo,
    multa_valor = EXCLUDED.multa_valor,
    multa_percentual = EXCLUDED.multa_percentual,
    multa_dias = EXCLUDED.multa_dias,
    juros_ativo = EXCLUDED.juros_ativo,
    juros_codigo_tipo = EXCLUDED.juros_codigo_tipo,
    juros_percentual_mes = EXCLUDED.juros_percentual_mes,
    juros_dias = EXCLUDED.juros_dias,
    desconto_expresso = EXCLUDED.desconto_expresso,
    protesto_ativo = EXCLUDED.protesto_ativo,
    protesto_codigo_tipo = EXCLUDED.protesto_codigo_tipo,
    protesto_dias = EXCLUDED.protesto_dias,
    negativacao_ativo = EXCLUDED.negativacao_ativo,
    negativacao_codigo_tipo = EXCLUDED.negativacao_codigo_tipo,
    negativacao_dias = EXCLUDED.negativacao_dias,
    dias_limite_pagamento = EXCLUDED.dias_limite_pagamento,
    instrucoes = EXCLUDED.instrucoes,
    recebimento_divergente = EXCLUDED.recebimento_divergente,
    forma_envio = EXCLUDED.forma_envio,
    chave_pix = EXCLUDED.chave_pix,
    bolecode_ativo = EXCLUDED.bolecode_ativo,
    updated_at = now()
  RETURNING to_jsonb(c) INTO v_out;

  RETURN v_out;
END $function$;
