-- Resumo do caso para exibir abaixo do campo "Caso" no form de timesheet
-- (Regra de cobrança · Produto · Responsável interno · Centro de custo, SEM valor)
-- e nas etapas 1/2/3 do faturamento (COM valor). RPC leve, SECURITY DEFINER,
-- identidade por auth.uid() (padrão do hardening); qualquer membro do tenant pode
-- consultar o resumo de um caso do próprio tenant (é o que ele lança hora).

CREATE OR REPLACE FUNCTION public.get_caso_resumo(p_caso_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'people', 'core'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_caso contracts.casos%ROWTYPE;
  v_regra text;
  v_regra_label text;
  v_cfg jsonb;
  v_valor numeric;
  v_unidade text := '';
  v_cc text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tu.tenant_id INTO v_tenant FROM core.tenant_users tu
   WHERE tu.user_id = v_uid AND tu.status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO v_caso FROM contracts.casos WHERE id = p_caso_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caso não encontrado'; END IF;

  v_regra := lower(coalesce(nullif(v_caso.regra_cobranca, ''), ''));
  v_regra_label := CASE v_regra
    WHEN 'hora' THEN 'Hora'
    WHEN 'projeto' THEN 'Projeto'
    WHEN 'projeto_parcelado' THEN 'Projeto parcelado'
    WHEN 'mensal' THEN 'Mensalidade'
    WHEN 'mensalidade_processo' THEN 'Mensalidade de processo'
    WHEN 'mensalidade_carteira' THEN 'Mensalidade de carteira'
    WHEN 'salario_minimo' THEN 'Mensalidade de processo'
    WHEN 'exito' THEN 'Êxito'
    WHEN '' THEN 'Sem regra'
    ELSE initcap(replace(v_regra, '_', ' '))
  END;

  v_cfg := coalesce(v_caso.regra_cobranca_config, '{}'::jsonb);
  v_valor := CASE v_regra
    WHEN 'projeto' THEN nullif(v_cfg->>'valor_projeto', '')::numeric
    WHEN 'projeto_parcelado' THEN nullif(v_cfg->>'valor_projeto', '')::numeric
    WHEN 'hora' THEN nullif(v_cfg->>'valor_hora', '')::numeric
    WHEN 'mensal' THEN nullif(v_cfg->>'valor_mensal', '')::numeric
    WHEN 'mensalidade_processo' THEN nullif(v_cfg->>'valor_mensal', '')::numeric
    WHEN 'mensalidade_carteira' THEN nullif(v_cfg->>'valor_mensal', '')::numeric
    ELSE NULL
  END;
  v_unidade := CASE v_regra
    WHEN 'hora' THEN '/h'
    WHEN 'mensal' THEN '/mês'
    WHEN 'mensalidade_processo' THEN '/mês'
    WHEN 'mensalidade_carteira' THEN '/mês'
    ELSE ''
  END;

  -- Centro de custo: rateio -> nomes de área (com % se houver mais de um)
  SELECT string_agg(
           coalesce(a.nome, 'Sem área')
             || CASE WHEN jsonb_array_length(coalesce(v_caso.centro_custo_rateio, '[]'::jsonb)) > 1
                     THEN ' ' || round(coalesce((elem->>'percentual')::numeric, 0)) || '%'
                     ELSE '' END,
           ' · ' ORDER BY (elem->>'percentual')::numeric DESC NULLS LAST)
    INTO v_cc
  FROM jsonb_array_elements(coalesce(v_caso.centro_custo_rateio, '[]'::jsonb)) AS elem
  LEFT JOIN people.areas a ON a.id = nullif(elem->>'centro_custo_id', '')::uuid;

  RETURN jsonb_build_object(
    'caso_id', v_caso.id,
    'numero', v_caso.numero,
    'nome', v_caso.nome,
    'regra', v_regra,
    'regra_label', v_regra_label,
    'produto', (SELECT p.nome FROM contracts.produtos p WHERE p.id = v_caso.produto_id),
    'responsavel', (SELECT k.nome FROM people.colaboradores k WHERE k.id = v_caso.responsavel_id),
    'centro_custo', v_cc,
    'valor', v_valor,
    'valor_unidade', v_unidade
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_caso_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caso_resumo(uuid) TO authenticated, service_role;
