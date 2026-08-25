-- =====================================================================
-- Recorrencia sem prazo nao pode acabar
--
-- cp_gerar_parcelas roda UMA VEZ, no cp_criar_lancamento, com horizonte de 12
-- meses. Para recorrencia com prazo (num_parcelas > 0) isso esta certo: gera as
-- N parcelas e acabou. Para recorrencia SEM PRAZO (num_parcelas = 0, que o
-- Filipe descreve como "despesa que nao tem data final") o efeito e outro:
-- gera 12 meses e nunca mais volta.
--
-- Hoje as 30 recorrencias do escritorio — R$ 112.787,10/mes de despesa fixa —
-- terminam entre 02/06/2027 e 27/07/2027. De julho de 2027 em diante o fluxo de
-- caixa mostraria ZERO despesa fixa, e o caixa projetado pareceria muito melhor
-- do que e. Ninguem receberia aviso: as linhas simplesmente nao existiriam.
--
-- A correcao e um horizonte ROLANTE: todo dia, garantir que cada recorrencia
-- sem prazo tenha ~12 meses de parcelas a frente da data de hoje. Idempotente
-- pela mesma chave logica que cp_gerar_parcelas usa (recorrencia_id,
-- parcela_numero), entao rodar duas vezes no mesmo dia nao duplica nada.
--
-- Chamada pelo cron diario (/api/cron/manter-recorrencias). Aceita p_user_id
-- nulo para o cron poder rodar sem usuario logado — nesse caso percorre todos
-- os tenants e usa o created_by do lancamento base de cada recorrencia.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cp_manter_recorrencias(
  p_user_id uuid DEFAULT NULL,
  p_horizonte_meses int DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  r RECORD;
  v_base finance.lancamentos%ROWTYPE;
  v_alvo date;
  v_total int;
  v_n int;
  v_venc date;
  v_criadas int := 0;
  v_tocadas int := 0;
BEGIN
  -- Com usuario: so o tenant dele. Sem usuario (cron): todos.
  IF p_user_id IS NOT NULL THEN
    v_tenant := finance._cp_tenant(p_user_id);
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  END IF;

  -- Ate onde as parcelas precisam chegar.
  v_alvo := (CURRENT_DATE + (p_horizonte_meses || ' month')::interval)::date;

  FOR r IN
    SELECT * FROM finance.recorrencias
    WHERE ativo
      AND num_parcelas = 0                      -- so as SEM PRAZO
      AND (v_tenant IS NULL OR tenant_id = v_tenant)
  LOOP
    -- Lancamento "modelo" = a 1a parcela, mesma logica de cp_gerar_parcelas.
    SELECT * INTO v_base FROM finance.lancamentos
     WHERE recorrencia_id = r.id AND tenant_id = r.tenant_id
     ORDER BY parcela_numero NULLS LAST LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    -- Quantas parcelas cabem entre o inicio e o alvo. Parcela n vence em
    -- inicio + (n-1) meses, entao n = meses(inicio -> alvo) + 1.
    v_total := (
      (EXTRACT(YEAR FROM v_alvo) - EXTRACT(YEAR FROM r.inicio)) * 12
      + (EXTRACT(MONTH FROM v_alvo) - EXTRACT(MONTH FROM r.inicio))
    )::int + 1;
    CONTINUE WHEN v_total < 2;

    FOR v_n IN 2..v_total LOOP
      v_venc := (r.inicio + ((v_n - 1) || ' month')::interval)::date;
      IF NOT EXISTS (
        SELECT 1 FROM finance.lancamentos
         WHERE recorrencia_id = r.id AND parcela_numero = v_n
      ) THEN
        INSERT INTO finance.lancamentos (
          tenant_id, natureza, tipo, status, empresa_id, fornecedor_nome, cliente_id,
          descricao, conta_contabil_id, centro_custo_id, valor, vencimento,
          recorrencia_id, parcela_numero, reembolsavel, forma_pagamento,
          conta_bancaria_id, observacoes, origem, created_by)
        VALUES (
          v_base.tenant_id, v_base.natureza, v_base.tipo, 'pendente', v_base.empresa_id,
          v_base.fornecedor_nome, v_base.cliente_id, v_base.descricao,
          v_base.conta_contabil_id, v_base.centro_custo_id, r.valor_base, v_venc,
          r.id, v_n, v_base.reembolsavel, v_base.forma_pagamento,
          v_base.conta_bancaria_id, v_base.observacoes, 'recorrencia',
          COALESCE(p_user_id, v_base.created_by));
        v_criadas := v_criadas + 1;
      END IF;
    END LOOP;

    v_tocadas := v_tocadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'recorrencias_verificadas', v_tocadas,
    'parcelas_criadas', v_criadas,
    'horizonte_ate', v_alvo);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cp_manter_recorrencias(uuid, int) TO authenticated, service_role;
