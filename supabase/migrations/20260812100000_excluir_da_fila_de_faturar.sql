-- Excluir lancamentos na secao "A liberar" (aguarda liberacao), pedido Filipe
-- 11/08. Ate aqui so existia "Postergar" (empurra para outro mes) e "Liberar
-- faturamento" (manda para revisao).
--
-- Esses itens ainda nao viraram billing_item — sao lidos ao vivo de
-- operations.timesheets por get_itens_a_faturar (ver CTE base_timesheet). Nao
-- existe uma linha em finance.billing_items para "excluir" como o
-- excluir_billing_items faz na revisao; a exclusao aqui precisa marcar a
-- ORIGEM diretamente.
--
-- Escopo: so os itens de timesheet (a mesma populacao que "Postergar" ja
-- aceita). Os itens de regra financeira (mensalidade, projeto, exito) sao
-- calculados ao vivo a partir da regra do caso a cada referencia de mes — nao
-- sao uma linha que se possa marcar. "Postergar" ja tem essa mesma limitacao
-- hoje (so mexe em timesheetIds), entao nao e um retrocesso.
--
-- Preserva o timesheet (nao apaga): so marca excluido_faturamento, para nao
-- perder o registro de horas trabalhadas, e para dar para reverter se for erro.
ALTER TABLE operations.timesheets
  ADD COLUMN IF NOT EXISTS excluido_faturamento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluido_faturamento_por uuid,
  ADD COLUMN IF NOT EXISTS excluido_faturamento_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_faturamento_motivo text;

CREATE OR REPLACE FUNCTION public.excluir_timesheets_do_faturamento(
  p_user_id uuid, p_ids uuid[], p_excluir boolean DEFAULT true, p_motivo text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_count int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Mesma permissao de quem ja libera faturamento (start_faturamento_flow):
  -- excluir da fila e uma decisao do mesmo tipo, nao um papel novo.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write', 'finance.faturamento.manage',
      'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para excluir lançamentos do faturamento';
  END IF;

  UPDATE operations.timesheets t
  SET excluido_faturamento = p_excluir,
      excluido_faturamento_por = CASE WHEN p_excluir THEN p_user_id ELSE NULL END,
      excluido_faturamento_em = CASE WHEN p_excluir THEN now() ELSE NULL END,
      excluido_faturamento_motivo = CASE WHEN p_excluir THEN NULLIF(trim(COALESCE(p_motivo, '')), '') ELSE NULL END,
      updated_at = now(),
      updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND t.id = ANY(p_ids)
    -- Uma vez ja faturado (existe billing_item ativo apontando pra ele) a
    -- exclusao daqui nao tem efeito nenhum — a linha ja saiu da fila. Evita a
    -- falsa sensacao de ter excluido algo que na verdade ja foi liberado.
    AND NOT EXISTS (
      SELECT 1 FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'timesheet'
        AND bi.origem_id = t.id AND bi.status <> 'cancelado'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('afetados', v_count);
END;
$function$;
