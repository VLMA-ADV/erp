-- Conciliação financeira por parcela na capa do caso (pedido do cliente).
-- Flags manuais: Faturada (NF emitida) e Paga (crédito baixado). Baixa é manual (conforme cliente).
-- As parcelas em si vivem em casos.regra_cobranca_config->parcelas (índice = posição no array).

CREATE TABLE IF NOT EXISTS contracts.caso_parcela_conciliacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  caso_id uuid NOT NULL REFERENCES contracts.casos(id) ON DELETE CASCADE,
  parcela_index int NOT NULL,
  faturada boolean NOT NULL DEFAULT false,
  faturada_at timestamptz,
  nf_ref varchar,
  paga boolean NOT NULL DEFAULT false,
  paga_at timestamptz,
  updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (caso_id, parcela_index)
);

-- Parcelas do caso + status de conciliação
CREATE OR REPLACE FUNCTION public.get_caso_parcelas(p_user_id uuid, p_caso_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, contracts, core AS $fn$
DECLARE v_tenant uuid; v_config jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT regra_cobranca_config INTO v_config FROM contracts.casos WHERE id=p_caso_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caso não encontrado'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'index', idx - 1,
      'valor', NULLIF(p->>'valor','')::numeric,
      'data_pagamento', p->>'data_pagamento',
      'faturada', COALESCE(c.faturada, false),
      'faturada_at', c.faturada_at,
      'nf_ref', c.nf_ref,
      'paga', COALESCE(c.paga, false),
      'paga_at', c.paga_at
    ) ORDER BY idx)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_config->'parcelas')='array' THEN v_config->'parcelas' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, idx)
    LEFT JOIN contracts.caso_parcela_conciliacao c ON c.caso_id=p_caso_id AND c.parcela_index=idx-1
  ), '[]'::jsonb);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_caso_parcelas(uuid, uuid) TO authenticated;

-- Marca/atualiza a conciliação de uma parcela
CREATE OR REPLACE FUNCTION public.set_parcela_conciliacao(
  p_user_id uuid, p_caso_id uuid, p_parcela_index int,
  p_faturada boolean, p_paga boolean, p_nf_ref varchar DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, contracts, core AS $fn$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts.casos WHERE id=p_caso_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  INSERT INTO contracts.caso_parcela_conciliacao (tenant_id, caso_id, parcela_index, faturada, faturada_at, nf_ref, paga, paga_at, updated_by, updated_at)
  VALUES (v_tenant, p_caso_id, p_parcela_index, COALESCE(p_faturada,false),
          CASE WHEN p_faturada THEN now() ELSE NULL END, NULLIF(p_nf_ref,''),
          COALESCE(p_paga,false), CASE WHEN p_paga THEN now() ELSE NULL END, p_user_id, now())
  ON CONFLICT (caso_id, parcela_index) DO UPDATE SET
    faturada = COALESCE(p_faturada, contracts.caso_parcela_conciliacao.faturada),
    faturada_at = CASE WHEN p_faturada THEN COALESCE(contracts.caso_parcela_conciliacao.faturada_at, now()) ELSE NULL END,
    nf_ref = COALESCE(NULLIF(p_nf_ref,''), contracts.caso_parcela_conciliacao.nf_ref),
    paga = COALESCE(p_paga, contracts.caso_parcela_conciliacao.paga),
    paga_at = CASE WHEN p_paga THEN COALESCE(contracts.caso_parcela_conciliacao.paga_at, now()) ELSE NULL END,
    updated_by = p_user_id, updated_at = now();

  RETURN jsonb_build_object('caso_id', p_caso_id, 'parcela_index', p_parcela_index, 'faturada', p_faturada, 'paga', p_paga);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.set_parcela_conciliacao(uuid, uuid, int, boolean, boolean, varchar) TO authenticated;
