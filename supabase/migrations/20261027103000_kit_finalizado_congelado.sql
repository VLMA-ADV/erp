-- Kit finalizado fica congelado (Filipe 16/10, Osul caso 1954, out/2026).
--
-- O kit da Composição era calculado na hora: todo billing_item aprovado/
-- faturado de (contrato, caso, competência) entrava. finalizar_kit só gravava
-- o carimbo em finance.kits — nunca QUAIS itens o kit tinha. Resultado: o kit
-- do caso 1954 foi finalizado e depois "cresceu" de 4h40 para 6h40 quando
-- outro lançamento foi aprovado. Pedido do cliente: o kit finalizado fica
-- como estava (com os documentos já gerados) e o que chegar depois aparece à
-- parte, para a pessoa decidir: unificar, faturar separado ou postergar.
--
-- Modelo:
--   finance.kits.item_ids  — conjunto do kit, gravado ao finalizar. NULL = kit
--                            "aberto": recebe os itens livres do grupo, como
--                            sempre foi (kits não finalizados não mudam).
--   finance.kits.sequencia — 1 = o kit de sempre. 2, 3… = "faturar separado":
--                            outro kit no mesmo caso+competência, com seus
--                            próprios documentos (metadata.kit_sequencia).
--   Item livre num grupo em que todos os kits estão congelados = "aprovado
--   depois de finalizar": não entra em kit nenhum, nem na NFS-e, até decidir.

ALTER TABLE finance.kits
  ADD COLUMN IF NOT EXISTS item_ids uuid[],
  ADD COLUMN IF NOT EXISTS sequencia smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN finance.kits.item_ids IS
  'Itens do kit congelados na finalização (Filipe 16/10). NULL = kit aberto, recebe os itens livres do caso+competência.';
COMMENT ON COLUMN finance.kits.sequencia IS
  '1 = kit do caso+competência; 2+ = kit faturado separado dos lançamentos aprovados depois de finalizar (Filipe 16/10).';

DROP INDEX IF EXISTS finance.kits_chave_uidx;
CREATE UNIQUE INDEX kits_chave_uidx ON finance.kits USING btree (
  tenant_id, contrato_id,
  (COALESCE(caso_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  competencia, sequencia);

-- Kits já finalizados: congela com o que têm HOJE. É o que a tela mostra e o
-- que os documentos registrados cobrem (o relatório do 1954 foi regerado às
-- 17:20 com os 3 itens). data_aprovacao não serve para "desfazer" o que
-- entrou depois: ela muda quando o item é reaprovado (caso 1936 tem um item
-- só, "aprovado" depois da finalização). Daqui para frente nada mais entra.
UPDATE finance.kits k
   SET item_ids = s.ids
  FROM (
    SELECT k2.id, array_agg(bi.id ORDER BY bi.created_at) AS ids
      FROM finance.kits k2
      JOIN finance.billing_items bi
        ON bi.tenant_id = k2.tenant_id
       AND bi.status IN ('aprovado', 'faturado')
       AND bi.contrato_id = k2.contrato_id
       AND bi.caso_id IS NOT DISTINCT FROM k2.caso_id
       AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = k2.competencia
     WHERE k2.finalizado_em IS NOT NULL
       AND k2.item_ids IS NULL
     GROUP BY k2.id
  ) s
 WHERE k.id = s.id;

-- Numeração única: o kit separado tem relatório/ND/NFS-e com número próprio.
ALTER TABLE finance.documento_numeros
  ADD COLUMN IF NOT EXISTS kit_sequencia smallint NOT NULL DEFAULT 1;
ALTER TABLE finance.documento_numeros DROP CONSTRAINT IF EXISTS documento_numeros_identidade_key;
ALTER TABLE finance.documento_numeros ADD CONSTRAINT documento_numeros_identidade_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, tipo_documento, contrato_id, caso_id, competencia, pagador_cliente_id, kit_sequencia);

-- ── Em que kit cada item está ────────────────────────────────────────────
-- Única regra de pertencimento, usada pela Composição, pela NFS-e (escopo),
-- pelo recebível, pelo e-mail e pela devolução — para todos concordarem.
--   1. item no item_ids de um kit congelado → esse kit;
--   2. senão, o kit aberto do grupo (item_ids NULL; o de maior sequência);
--   3. senão, grupo sem kit congelado (com itens) → kit 1, como sempre;
--   4. senão → pendente: aprovado depois de finalizar, aguardando decisão.
-- SQL simples, sem SECURITY DEFINER: quem chama já é SECURITY DEFINER.
CREATE OR REPLACE FUNCTION finance.kit_atribuicao(p_tenant uuid, p_contrato_id uuid DEFAULT NULL)
RETURNS TABLE (item_id uuid, contrato_id uuid, caso_id uuid, competencia date,
               kit_sequencia smallint, pendente boolean)
LANGUAGE sql
STABLE
AS $function$
  WITH itens AS (
    SELECT bi.id, bi.contrato_id, bi.caso_id,
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date AS competencia
      FROM finance.billing_items bi
     WHERE bi.tenant_id = p_tenant
       AND bi.status IN ('aprovado', 'faturado')
       AND (p_contrato_id IS NULL OR bi.contrato_id = p_contrato_id)
  ),
  kits AS (
    SELECT k.contrato_id, k.caso_id, k.competencia, k.sequencia, k.item_ids
      FROM finance.kits k
     WHERE k.tenant_id = p_tenant
       AND (p_contrato_id IS NULL OR k.contrato_id = p_contrato_id)
  ),
  congelado AS (
    SELECT DISTINCT ON (i.id) i.id, k.sequencia
      FROM itens i
      JOIN kits k ON k.contrato_id = i.contrato_id
                 AND k.caso_id IS NOT DISTINCT FROM i.caso_id
                 AND k.competencia = i.competencia
                 AND k.item_ids IS NOT NULL
                 AND i.id = ANY (k.item_ids)
     ORDER BY i.id, k.sequencia
  ),
  grupo_congelado AS (
    SELECT DISTINCT i.contrato_id, i.caso_id, i.competencia
      FROM itens i JOIN congelado c ON c.id = i.id
  ),
  receptor AS (
    SELECT k.contrato_id, k.caso_id, k.competencia, max(k.sequencia) AS sequencia
      FROM kits k
     WHERE k.item_ids IS NULL
     GROUP BY k.contrato_id, k.caso_id, k.competencia
  )
  SELECT i.id, i.contrato_id, i.caso_id, i.competencia,
         COALESCE(c.sequencia, r.sequencia,
                  CASE WHEN gc.contrato_id IS NULL THEN 1::smallint END) AS kit_sequencia,
         (c.id IS NULL AND r.sequencia IS NULL AND gc.contrato_id IS NOT NULL) AS pendente
    FROM itens i
    LEFT JOIN congelado c ON c.id = i.id
    LEFT JOIN receptor r ON r.contrato_id = i.contrato_id
                        AND r.caso_id IS NOT DISTINCT FROM i.caso_id
                        AND r.competencia = i.competencia
    LEFT JOIN grupo_congelado gc ON gc.contrato_id = i.contrato_id
                                AND gc.caso_id IS NOT DISTINCT FROM i.caso_id
                                AND gc.competencia = i.competencia;
$function$;

REVOKE ALL ON FUNCTION finance.kit_atribuicao(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Mesmo bloqueio de get_composicao_fatura.motivo_bloqueio / excluir_kit, para
-- UM kit: NFS-e autorizada/processando sobre os itens dele, ou boleto vivo
-- (na NFS-e dos itens ou na nota de débito do kit). NULL = livre.
CREATE OR REPLACE FUNCTION finance._kit_bloqueio(p_tenant uuid, p_contrato_id uuid, p_caso_id uuid,
                                                 p_competencia date, p_sequencia smallint)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'finance', 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_nota record;
BEGIN
  SELECT array_agg(a.item_id) INTO v_ids
    FROM finance.kit_atribuicao(p_tenant, p_contrato_id) a
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = p_competencia
     AND a.kit_sequencia = p_sequencia
     AND NOT a.pendente;

  SELECT bn.focus_status, bn.caso_id,
         COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                  NULLIF(bn.metadata->>'nfse_numero', ''), bn.numero::text) AS nfse_numero
    INTO v_nota
    FROM finance.billing_notes bn
   WHERE bn.tenant_id = p_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('autorizado', 'processando')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
                  WHERE x.value::uuid = ANY (COALESCE(v_ids, '{}')))
   ORDER BY bn.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN 'NFS-e ' || v_nota.nfse_numero ||
           CASE WHEN v_nota.focus_status = 'autorizado' THEN ' autorizada' ELSE ' em processamento' END;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE bn.tenant_id = p_tenant
       AND b.status NOT IN ('cancelado', 'erro', 'baixado')
       AND (
         (bn.tipo_documento = 'nota_fiscal_servico' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
             WHERE x.value::uuid = ANY (COALESCE(v_ids, '{}'))))
         OR
         (bn.tipo_documento = 'nota_debito'
          AND bn.contrato_id = p_contrato_id
          AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
          AND NULLIF(bn.metadata->>'competencia', '')::date = p_competencia
          AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = p_sequencia)
       )
  ) THEN
    RETURN 'Boleto registrado';
  END IF;

  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION finance._kit_bloqueio(uuid, uuid, uuid, date, smallint) FROM PUBLIC, anon, authenticated;
-- ── Linha do kit por sequência ───────────────────────────────────────────
-- Assinatura ganha p_sequencia no fim (DEFAULT 1): quem chama com 4
-- argumentos continua no kit 1, como antes. O ON CONFLICT antigo apontava
-- para o índice sem sequência, que deixou de existir.
DROP FUNCTION IF EXISTS finance._kit_upsert(uuid, uuid, uuid, date);
CREATE FUNCTION finance._kit_upsert(p_tenant uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date,
                                    p_sequencia smallint DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'public'
AS $function$
DECLARE
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_seq smallint := COALESCE(p_sequencia, 1);
  v_id uuid;
BEGIN
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos ct WHERE ct.id = p_contrato_id AND ct.tenant_id = p_tenant
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  IF p_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = p_caso_id AND cs.tenant_id = p_tenant AND cs.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado no contrato';
  END IF;
  -- Mesma regra de pertencimento da Composição (finance.kit_atribuicao). Um
  -- kit separado recém-criado (sem itens ainda) já tem linha: passa.
  IF NOT EXISTS (
    SELECT 1 FROM finance.kit_atribuicao(p_tenant, p_contrato_id) a
     WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
       AND a.competencia = v_competencia
       AND a.kit_sequencia = v_seq
       AND NOT a.pendente
  ) AND NOT EXISTS (
    SELECT 1 FROM finance.kits k
     WHERE k.tenant_id = p_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia AND k.sequencia = v_seq
  ) THEN
    RAISE EXCEPTION 'Kit sem itens aprovados na competência %', to_char(v_competencia, 'MM/YYYY');
  END IF;

  INSERT INTO finance.kits (tenant_id, contrato_id, caso_id, competencia, sequencia)
  VALUES (p_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq)
  ON CONFLICT (tenant_id, contrato_id,
               (COALESCE(caso_id, '00000000-0000-0000-0000-000000000000'::uuid)),
               competencia, sequencia)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION finance._kit_upsert(uuid, uuid, uuid, date, smallint) FROM PUBLIC, anon, authenticated;

-- ── Finalizar: grava o carimbo E o conjunto de itens ─────────────────────
DROP FUNCTION IF EXISTS public.finalizar_kit(uuid, uuid, uuid, date, text);
CREATE FUNCTION public.finalizar_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date,
                                     p_obs text DEFAULT NULL::text, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_seq smallint := COALESCE(p_kit_sequencia, 1)::smallint;
  v_id uuid;
  v_nome text;
  v_em timestamptz := now();
  v_ids uuid[];
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para finalizar o kit';
  END IF;

  -- O que o kit tem AGORA (antes de criar a linha, que muda a atribuição).
  SELECT array_agg(a.item_id) INTO v_ids
    FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = v_competencia
     AND a.kit_sequencia = v_seq
     AND NOT a.pendente;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Kit sem itens aprovados na competência %', to_char(v_competencia, 'MM/YYYY');
  END IF;

  v_id := finance._kit_upsert(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);

  -- Filipe 16/10: finalizado = congelado. Lançamento aprovado depois não
  -- entra; aparece à parte na Composição para decidir.
  UPDATE finance.kits
     SET finalizado_em = v_em,
         finalizado_por = p_user_id,
         finalizado_obs = NULLIF(trim(COALESCE(p_obs, '')), ''),
         item_ids = COALESCE(item_ids, v_ids),
         updated_at = now()
   WHERE id = v_id;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'kit_id', v_id,
    'itens', cardinality(v_ids),
    'finalizado', jsonb_build_object(
      'em', v_em, 'por_nome', COALESCE(v_nome, 'Usuário'),
      'obs', NULLIF(trim(COALESCE(p_obs, '')), ''))
  );
END $function$;
GRANT EXECUTE ON FUNCTION public.finalizar_kit(uuid, uuid, uuid, date, text, integer) TO authenticated, service_role;

-- ── Reabrir ──────────────────────────────────────────────────────────────
-- Reabrir descongela (o kit volta a receber os itens livres do grupo) — é o
-- "unificar" do Filipe. Por isso tem a mesma trava: com lançamentos novos à
-- espera e NFS-e autorizada/boleto vivo, reabrir os jogaria num kit que já
-- foi para a prefeitura/banco. Kit separado que não é o último do grupo só
-- perde o carimbo (o aberto do grupo continua sendo o outro).
DROP FUNCTION IF EXISTS public.reabrir_kit(uuid, uuid, uuid, date);
CREATE FUNCTION public.reabrir_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date,
                                   p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_seq smallint := COALESCE(p_kit_sequencia, 1)::smallint;
  v_n int := 0;
  v_outro_aberto boolean;
  v_pendentes int;
  v_motivo text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para reabrir o kit';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM finance.kits k
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia
       AND k.sequencia <> v_seq AND k.item_ids IS NULL
  ) INTO v_outro_aberto;

  IF NOT v_outro_aberto THEN
    SELECT count(*) INTO v_pendentes
      FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
     WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
       AND a.competencia = v_competencia AND a.pendente;
    IF v_pendentes > 0 THEN
      v_motivo := finance._kit_bloqueio(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);
      IF v_motivo IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reaberto', false,
          'motivo', v_motivo || ': há ' || v_pendentes || ' lançamento(s) aprovado(s) depois de finalizar. '
                    || 'Fature-os separado ou postergue antes de reabrir.');
      END IF;
    END IF;
  END IF;

  UPDATE finance.kits
     SET finalizado_em = NULL, finalizado_por = NULL, finalizado_obs = NULL,
         item_ids = CASE WHEN v_outro_aberto THEN item_ids ELSE NULL END,
         updated_at = now()
   WHERE tenant_id = v_tenant
     AND contrato_id = p_contrato_id
     AND caso_id IS NOT DISTINCT FROM p_caso_id
     AND competencia = v_competencia
     AND sequencia = v_seq
     AND finalizado_em IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'reaberto', v_n > 0);
END $function$;
GRANT EXECUTE ON FUNCTION public.reabrir_kit(uuid, uuid, uuid, date, integer) TO authenticated, service_role;

-- ── Lançamentos aprovados depois de finalizar: a decisão ─────────────────
-- p_acao: 'unificar' (reabre o último kit congelado do grupo — mesma trava
-- do reabrir), 'separar' (cria o kit N+1, aberto, que recebe os itens) ou
-- 'postergar' (manda cada item para a competência seguinte pelas RPCs de
-- postergar de sempre; despesa por postergar_despesa).
CREATE OR REPLACE FUNCTION public.decidir_lancamentos_pos_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid,
                                                              p_competencia date, p_acao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_proxima date := (date_trunc('month', p_competencia) + interval '1 month')::date;
  v_acao text := lower(trim(COALESCE(p_acao, '')));
  v_ids uuid[];
  v_seq smallint;
  v_motivo text;
  v_id uuid;
  v_feitos int := 0;
  v_falhas jsonb := '[]'::jsonb;
  r record;
BEGIN
  -- Via PostgREST, p_user_id tem de ser quem está logado.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para mexer no kit';
  END IF;
  IF v_acao NOT IN ('unificar', 'separar', 'postergar') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_acao;
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;

  SELECT array_agg(a.item_id) INTO v_ids
    FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = v_competencia
     AND a.pendente;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Não há lançamentos aprovados depois de finalizar neste caso e competência.');
  END IF;

  IF v_acao = 'unificar' THEN
    -- O último kit com itens do caso+competência — o mesmo em que a
    -- Composição mostra o bloco (com pendentes, todos estão congelados).
    SELECT max(a.kit_sequencia) INTO v_seq
      FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
     WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
       AND a.competencia = v_competencia AND NOT a.pendente;
    v_motivo := finance._kit_bloqueio(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);
    IF v_motivo IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false,
        'motivo', v_motivo || ' no kit: não dá para unificar. Fature separado ou postergue.');
    END IF;
    UPDATE finance.kits k
       SET finalizado_em = NULL, finalizado_por = NULL, finalizado_obs = NULL,
           item_ids = NULL, updated_at = now()
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia AND k.sequencia = v_seq;
    RETURN jsonb_build_object('ok', true, 'acao', v_acao, 'kit_sequencia', v_seq, 'itens', cardinality(v_ids));
  END IF;

  IF v_acao = 'separar' THEN
    SELECT COALESCE(max(k.sequencia), 1) + 1 INTO v_seq FROM finance.kits k
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia;
    INSERT INTO finance.kits (tenant_id, contrato_id, caso_id, competencia, sequencia)
    VALUES (v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'acao', v_acao, 'kit_sequencia', v_seq, 'kit_id', v_id,
                              'itens', cardinality(v_ids));
  END IF;

  -- postergar: item a item; um que falhe não trava os outros.
  FOR r IN
    SELECT bi.id, bi.origem_tipo, bi.origem_id, bi.caso_id, bi.data_referencia, bi.snapshot,
           COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) AS valor
      FROM finance.billing_items bi
     WHERE bi.id = ANY (v_ids)
  LOOP
    BEGIN
      IF r.origem_tipo = 'timesheet' THEN
        PERFORM public.postergar_timesheet(p_user_id, r.origem_id, v_proxima);
      ELSIF r.origem_tipo = 'despesa' THEN
        -- postergar_despesa (#460) também devolve a despesa a 'em_lancamento';
        -- só cancelar o item deixaria o trigger marcá-la 'cancelado' e ela
        -- sumiria da fila do mês seguinte.
        PERFORM public.postergar_despesa(p_user_id, r.origem_id, v_proxima);
      ELSE
        PERFORM public.postergar_item_regra(
          p_user_id, r.caso_id, r.origem_id,
          lower(COALESCE(NULLIF(r.snapshot->>'regra_cobranca', ''), r.origem_tipo)),
          v_competencia, v_proxima, r.valor,
          COALESCE(NULLIF(r.snapshot->>'regra', ''), NULLIF(r.snapshot->>'descricao', ''), 'Item de faturamento'),
          r.data_referencia, 'Aprovado depois de finalizar o kit');
      END IF;
      v_feitos := v_feitos + 1;
    EXCEPTION WHEN others THEN
      v_falhas := v_falhas || jsonb_build_object('item_id', r.id, 'motivo', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', v_feitos > 0, 'acao', v_acao, 'postergados', v_feitos,
                            'periodo', v_proxima, 'falhas', v_falhas,
                            'motivo', CASE WHEN v_feitos = 0 THEN v_falhas->0->>'motivo' END);
END $function$;
REVOKE ALL ON FUNCTION public.decidir_lancamentos_pos_kit(uuid, uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_lancamentos_pos_kit(uuid, uuid, uuid, date, text) TO authenticated, service_role;
-- ── Ajustes por kit (sequência) ──
DROP FUNCTION IF EXISTS public.salvar_ajustes_kit(uuid, uuid, uuid, date, jsonb, boolean);
CREATE FUNCTION public.salvar_ajustes_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_ajustes jsonb, p_salvar_no_cadastro boolean DEFAULT false, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_grupo_id uuid;
  v_grupo_nome text;
  v_pagadores jsonb;          -- [{cliente_id, nome, percentual}] para o kit
  v_pagadores_cadastro jsonb; -- [{cliente_id, percentual}] para o cadastro
  v_soma numeric;
  v_ajustes jsonb;
  v_cadastro jsonb := NULL;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o kit';
  END IF;
  IF p_ajustes IS NOT NULL AND jsonb_typeof(p_ajustes) <> 'object' THEN
    RAISE EXCEPTION 'Ajustes inválidos';
  END IF;

  -- Grupo de impostos: tem de existir no tenant.
  v_grupo_id := NULLIF(p_ajustes->>'grupo_imposto_id', '')::uuid;
  IF v_grupo_id IS NOT NULL THEN
    SELECT gi.nome INTO v_grupo_nome FROM contracts.grupos_impostos gi
     WHERE gi.id = v_grupo_id AND gi.tenant_id = v_tenant;
    IF v_grupo_nome IS NULL THEN RAISE EXCEPTION 'Grupo de impostos não encontrado'; END IF;
  END IF;

  -- Pagadores: clientes do tenant, percentuais fechando 100%.
  IF jsonb_typeof(p_ajustes->'pagadores') = 'array' AND jsonb_array_length(p_ajustes->'pagadores') > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('cliente_id', pg.cliente_id, 'nome', c.nome, 'percentual', pg.percentual)
                     ORDER BY pg.percentual DESC, c.nome),
           jsonb_agg(jsonb_build_object('cliente_id', pg.cliente_id, 'percentual', pg.percentual)
                     ORDER BY pg.percentual DESC, c.nome),
           sum(pg.percentual)
      INTO v_pagadores, v_pagadores_cadastro, v_soma
      FROM (
        SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
               round(COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 0), 2) AS percentual
          FROM jsonb_array_elements(p_ajustes->'pagadores') p
      ) pg
      LEFT JOIN crm.clientes c ON c.id = pg.cliente_id AND c.tenant_id = v_tenant;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_ajustes->'pagadores') p
      LEFT JOIN crm.clientes c ON c.id = NULLIF(p.value->>'cliente_id', '')::uuid AND c.tenant_id = v_tenant
      WHERE c.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Pagador não encontrado entre os clientes';
    END IF;
    IF abs(v_soma - 100) > 0.01 THEN
      RAISE EXCEPTION 'Os percentuais dos pagadores somam %, precisam somar 100%%', v_soma;
    END IF;
  END IF;

  -- Ajuste vale para o kit da tela (kit separado tem o seu, Filipe 16/10).
  v_id := finance._kit_upsert(v_tenant, p_contrato_id, p_caso_id, p_competencia, COALESCE(p_kit_sequencia, 1)::smallint);

  v_ajustes := CASE WHEN v_grupo_id IS NULL AND v_pagadores IS NULL THEN NULL
               ELSE jsonb_build_object('grupo_imposto_id', v_grupo_id, 'pagadores', v_pagadores) END;

  UPDATE finance.kits
     SET ajustes = v_ajustes,
         ajustes_atualizado_em = now(),
         ajustes_por = p_user_id,
         updated_at = now()
   WHERE id = v_id;

  IF p_salvar_no_cadastro AND (v_grupo_id IS NOT NULL OR v_pagadores_cadastro IS NOT NULL) THEN
    v_cadastro := public.aplicar_ajustes_no_cadastro(
      p_user_id, p_contrato_id, p_caso_id, v_pagadores_cadastro, v_grupo_id, NULL, NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kit_id', v_id,
    'ajustes_kit', CASE WHEN v_ajustes IS NULL THEN NULL ELSE jsonb_build_object(
      'grupo_imposto_id', v_grupo_id, 'grupo_imposto_nome', v_grupo_nome, 'pagadores', v_pagadores) END,
    'alterado_no_cadastro', (v_cadastro IS NOT NULL
                             AND jsonb_array_length(COALESCE(v_cadastro->'alterado', '[]'::jsonb)) > 0),
    'alterado', COALESCE(v_cadastro->'alterado', '[]'::jsonb)
  );
END $function$;
GRANT EXECUTE ON FUNCTION public.salvar_ajustes_kit(uuid, uuid, uuid, date, jsonb, boolean, integer) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.get_composicao_fatura(p_user_id uuid, p_competencia date DEFAULT NULL::date, p_cliente_id uuid DEFAULT NULL::uuid, p_contrato_id uuid DEFAULT NULL::uuid, p_caso_id uuid DEFAULT NULL::uuid, p_regra text DEFAULT NULL::text, p_status_kit text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_regra text := NULLIF(trim(COALESCE(p_regra, '')), '');
  v_status text := NULLIF(trim(COALESCE(p_status_kit, '')), '');
  v_out jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.read', 'finance.faturamento.manage',
                               'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver a composição da fatura';
  END IF;

  -- Filipe 16/10 (Osul, caso 1954): kit finalizado fica congelado. Em que
  -- kit cada item está vem de finance.kit_atribuicao — a mesma regra da
  -- NFS-e, do recebível e do e-mail. Item aprovado depois de finalizar
  -- (pendente) não entra em kit: vira o bloco pos_finalizacao do caso.
  WITH atr AS (
    SELECT * FROM finance.kit_atribuicao(v_tenant)
  ),
  itens AS (
    SELECT bi.id, bi.contrato_id, bi.caso_id, bi.origem_tipo, bi.origem_id, bi.status,
           a.kit_sequencia, a.pendente,
           bi.data_referencia, bi.snapshot, bi.created_at,
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date AS competencia,
           -- Mesmo valor que vai na NFS-e (get_billing_items_aprovados_full).
           COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)::numeric AS valor,
           -- Horas de TODO item de timesheet, valha ele R$ 0 ou não (6.2).
           CASE WHEN bi.origem_tipo = 'timesheet'
                THEN COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0)
                ELSE 0 END::numeric AS horas
      FROM finance.billing_items bi
      JOIN atr a ON a.item_id = bi.id
     WHERE bi.tenant_id = v_tenant
       AND bi.status IN ('aprovado', 'faturado')
  ),
  -- Chave do kit 1 igual à de sempre; kit separado ganha '|k<n>'; o bloco dos
  -- aprovados depois de finalizar, '|pos'.
  itens_todos AS (
    SELECT i.*,
           COALESCE(i.caso_id::text, 'contrato:' || i.contrato_id::text) || '|' || i.competencia::text AS grupo,
           COALESCE(i.caso_id::text, 'contrato:' || i.contrato_id::text) || '|' || i.competencia::text
             || CASE WHEN i.pendente THEN '|pos'
                     WHEN i.kit_sequencia > 1 THEN '|k' || i.kit_sequencia::text
                     ELSE '' END AS chave
      FROM itens i
  ),
  itens_chave AS (
    SELECT * FROM itens_todos WHERE NOT pendente
  ),
  kits AS (
    SELECT ic.chave, ic.grupo, ic.caso_id, ic.contrato_id, ic.competencia, ic.kit_sequencia,
           array_agg(ic.id) AS item_ids,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN 0 ELSE ic.valor END), 2) AS valor_servico,
           round(sum(CASE WHEN ic.origem_tipo = 'despesa' THEN ic.valor ELSE 0 END), 2) AS valor_despesa,
           round(sum(ic.horas), 2) AS horas,
           count(*) FILTER (WHERE ic.origem_tipo = 'timesheet') AS lancamentos_timesheet,
           round(sum(ic.valor), 2) AS valor_total
      FROM itens_chave ic
     GROUP BY ic.chave, ic.grupo, ic.caso_id, ic.contrato_id, ic.competencia, ic.kit_sequencia
  ),
  -- A NFS-e cobre um kit por vez (get_billing_items_aprovados_escopo): o de
  -- menor sequência com serviço ainda aprovado. Os seguintes esperam.
  grupo_nfse AS (
    SELECT ic.grupo, min(ic.kit_sequencia) AS primeiro
      FROM itens_chave ic
     WHERE ic.status = 'aprovado' AND ic.origem_tipo <> 'despesa'
     GROUP BY ic.grupo
  ),
  pos AS (
    SELECT it.grupo,
           count(*) AS itens,
           round(sum(CASE WHEN it.origem_tipo = 'despesa' THEN 0 ELSE it.valor END), 2) AS valor_servico,
           round(sum(CASE WHEN it.origem_tipo = 'despesa' THEN it.valor ELSE 0 END), 2) AS valor_despesa,
           round(sum(it.horas), 2) AS horas,
           count(*) FILTER (WHERE it.origem_tipo = 'timesheet') AS lancamentos_timesheet,
           round(sum(it.valor), 2) AS valor_total
      FROM itens_todos it
     WHERE it.pendente
     GROUP BY it.grupo
  ),
  -- (nota NFS-e, item) para cruzar com os kits sem varrer jsonb por kit.
  nota_itens AS (
    SELECT bn.id AS nota_id, x.value::uuid AS item_id
      FROM finance.billing_notes bn
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_fiscal_servico'
  ),
  kit_notas AS (
    SELECT DISTINCT ic.chave, ni.nota_id
      FROM itens_chave ic
      JOIN nota_itens ni ON ni.item_id = ic.id
  ),
  -- B1: quantos CASOS cada NFS-e cobre. Mais de um = nota conjunta (nota única
  -- por contrato, Filipe 07/10: Charles Sturmer, casos 1873 e 1877). Conta
  -- casos, não kits: a mesma nota com itens de dois meses do MESMO caso (A&S
  -- Fersa 2103, Bravia 2104) não é conjunta.
  nota_kits AS (
    SELECT ni.nota_id,
           count(DISTINCT COALESCE(ic.caso_id::text, 'contrato:' || ic.contrato_id::text)) AS n_kits
      FROM nota_itens ni
      JOIN itens_chave ic ON ic.id = ni.item_id
     GROUP BY ni.nota_id
  ),
  -- A NFS-e "do kit": a viva (gerado) primeiro, depois a mais recente.
  kit_nfse AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, bn.id, bn.numero, bn.numero_documento, bn.status, bn.focus_status, bn.caso_id,
           bn.arquivo_nome, bn.arquivo_url, bn.created_at,
           COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                    NULLIF(bn.metadata->>'nfse_numero', '')) AS nfse_numero,
           NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total,
           (bn.caso_id IS NULL OR COALESCE(nk.n_kits, 1) > 1) AS compartilhada
      FROM kit_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
      LEFT JOIN nota_kits nk ON nk.nota_id = bn.id
     ORDER BY kn.chave, (bn.status = 'gerado') DESC, bn.created_at DESC
  ),
  -- Conta a receber da NFS-e do kit (cancelada por último, como em Notas geradas).
  kit_lanc AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nfse kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.id
     ORDER BY kn.chave, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_boleto AS (
    SELECT DISTINCT ON (kl.chave)
           kl.chave, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_lanc kl
      JOIN finance.boletos b ON b.lancamento_id = kl.id
     ORDER BY kl.chave, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  -- D11: boleto vivo em QUALQUER nota desses itens (até de nota cancelada) trava o kit.
  kit_boleto_vivo AS (
    SELECT DISTINCT kn.chave
      FROM kit_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE b.status NOT IN ('cancelado', 'erro', 'baixado')
  ),
  -- Rateio de pagadores (Filipe 08/10, caso 318): emit-nfse emite UMA NFS-e por
  -- pagador com os mesmos item_ids, e cada nota tem a sua conta a receber (no
  -- nome do pagador). Aqui, TODAS as NFS-e vivas do kit, cada uma com a sua
  -- conta e o seu boleto. kit_nfse acima continua escolhendo uma só (campos
  -- antigos intactos).
  kit_nfses_vivas AS (
    SELECT kn.chave, bn.id, bn.numero, bn.numero_documento, bn.status, bn.focus_status, bn.arquivo_url,
           COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                    NULLIF(bn.metadata->>'nfse_numero', '')) AS nfse_numero,
           NULLIF(bn.metadata->>'valor_total', '')::numeric AS valor_total,
           COALESCE(NULLIF(bn.metadata->>'pagador_cliente_id', '')::uuid, ct.cliente_id) AS pagador_id
      FROM kit_notas kn
      JOIN finance.billing_notes bn ON bn.id = kn.nota_id
      JOIN kits k ON k.chave = kn.chave
      JOIN contracts.contratos ct ON ct.id = k.contrato_id
     WHERE bn.status = 'gerado'
       AND COALESCE(bn.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
  ),
  kit_nfses_lanc AS (
    SELECT DISTINCT ON (nv.id)
           nv.id AS nota_id, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM (SELECT DISTINCT id FROM kit_nfses_vivas) nv
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = nv.id
     ORDER BY nv.id, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_nfses_boleto AS (
    SELECT DISTINCT ON (nl.id)
           nl.id AS lanc_id, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_nfses_lanc nl
      JOIN finance.boletos b ON b.lancamento_id = nl.id
     ORDER BY nl.id, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  kit_nfses AS (
    SELECT nv.chave,
           count(*) AS n,
           bool_and(COALESCE(nl.status IN ('pago', 'recebido') OR nl.baixa_data IS NOT NULL, false)) AS todas_pagas,
           jsonb_agg(jsonb_build_object(
             'id', nv.id, 'numero', nv.numero, 'numero_documento', nv.numero_documento,
             'nfse_numero', nv.nfse_numero,
             'status', nv.status, 'focus_status', nv.focus_status,
             'arquivo_url', nv.arquivo_url, 'valor_total', nv.valor_total,
             'pagador', jsonb_build_object('cliente_id', nv.pagador_id, 'nome', pc.nome),
             'conta_receber', CASE WHEN nl.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', nl.id, 'valor', nl.valor, 'vencimento', nl.vencimento,
               'status', nl.status, 'pago_em', nl.baixa_data) END,
             'boleto', CASE WHEN nb.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', nb.id, 'status', nb.status, 'vencimento', nb.vencimento,
               'valor', nb.valor, 'linha_digitavel', nb.linha_digitavel,
               'nosso_numero', nb.nosso_numero, 'pix_emv', nb.pix_copia_cola) END
           ) ORDER BY pc.nome NULLS LAST, nv.numero) AS nfses
      FROM kit_nfses_vivas nv
      LEFT JOIN crm.clientes pc ON pc.id = nv.pagador_id
      LEFT JOIN kit_nfses_lanc nl ON nl.nota_id = nv.id
      LEFT JOIN kit_nfses_boleto nb ON nb.lanc_id = nl.id
     GROUP BY nv.chave
  ),
  -- Notas de débito do kit, de QUALQUER status: a conta a receber pode estar
  -- numa ND já substituída (regerada com boleto vivo) — mesma lógica da NFS-e.
  kit_nd_notas AS (
    SELECT k.chave, bn.id AS nota_id
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_debito'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = k.kit_sequencia
  ),
  kit_nd_lanc AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, l.id, l.status::text AS status, l.valor, l.vencimento, l.baixa_data
      FROM kit_nd_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
     ORDER BY kn.chave, (l.status = 'cancelado'), l.created_at DESC
  ),
  kit_nd_boleto AS (
    SELECT DISTINCT ON (kl.chave)
           kl.chave, b.id, b.status, b.vencimento, b.valor, b.linha_digitavel,
           b.nosso_numero, b.pix_copia_cola
      FROM kit_nd_lanc kl
      JOIN finance.boletos b ON b.lancamento_id = kl.id
     ORDER BY kl.chave, (b.status IN ('erro', 'baixado', 'cancelado')), b.created_at DESC
  ),
  kit_nd_boleto_vivo AS (
    SELECT DISTINCT kn.chave
      FROM kit_nd_notas kn
      JOIN finance.lancamentos l ON l.tenant_id = v_tenant
                                AND l.origem = 'faturamento' AND l.origem_ref_id = kn.nota_id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE b.status NOT IN ('cancelado', 'erro', 'baixado')
  ),
  kit_envio AS (
    SELECT DISTINCT ON (kn.chave)
           kn.chave, e.enviado_em, e.destinatario, e.erro, c.nome AS por,
           count(*) OVER (PARTITION BY kn.chave) AS total,
           bool_or(e.erro IS NULL) OVER (PARTITION BY kn.chave) AS algum_ok
      FROM kit_nfse kn
      JOIN finance.fatura_envios e ON e.tenant_id = v_tenant AND e.billing_note_id = kn.id
      LEFT JOIN people.colaboradores c ON c.user_id = e.enviado_por AND c.tenant_id = v_tenant
     ORDER BY kn.chave, e.enviado_em DESC
  ),
  -- Relatório de timesheet / nota de débito registrados (D12-a), por kit.
  kit_docs AS (
    SELECT DISTINCT ON (k.chave, bn.tipo_documento)
           k.chave, bn.tipo_documento, bn.id, bn.numero_documento, bn.created_at, bn.arquivo_nome, bn.arquivo_url,
           COALESCE(NULLIF(bn.metadata->>'gerado_por_nome', ''), c.nome) AS gerado_por
      FROM kits k
      JOIN finance.billing_notes bn
        ON bn.tenant_id = v_tenant
       AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
       AND bn.status = 'gerado'
       AND bn.contrato_id = k.contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM k.caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = k.competencia
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = k.kit_sequencia
      LEFT JOIN people.colaboradores c ON c.user_id = bn.created_by AND c.tenant_id = v_tenant
     ORDER BY k.chave, bn.tipo_documento, bn.created_at DESC
  ),
  -- Estado do kit (24/09): carimbo de finalizado e ajustes desta competência.
  -- Nome do pagador e do grupo resolvidos na hora (o cadastro pode ter mudado
  -- depois que o ajuste foi salvo).
  kit_estado AS (
    SELECT k.chave,
           fk.finalizado_em, fk.finalizado_obs,
           (fk.item_ids IS NOT NULL) AS congelado,
           COALESCE(cf.nome, 'Usuário') AS finalizado_por_nome,
           NULLIF(fk.ajustes->>'grupo_imposto_id', '')::uuid AS aj_grupo_id,
           gia.nome AS aj_grupo_nome,
           CASE WHEN jsonb_typeof(fk.ajustes->'pagadores') = 'array'
                 AND jsonb_array_length(fk.ajustes->'pagadores') > 0
                THEN (
                  SELECT jsonb_agg(jsonb_build_object(
                           'cliente_id', pg.cliente_id, 'nome', pc.nome, 'percentual', pg.percentual)
                         ORDER BY pg.percentual DESC, pc.nome)
                    FROM (
                      SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
                             COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 100) AS percentual
                        FROM jsonb_array_elements(fk.ajustes->'pagadores') p
                    ) pg
                    LEFT JOIN crm.clientes pc ON pc.id = pg.cliente_id)
                ELSE NULL END AS aj_pagadores
      FROM kits k
      JOIN finance.kits fk
        ON fk.tenant_id = v_tenant
       AND fk.contrato_id = k.contrato_id
       AND fk.caso_id IS NOT DISTINCT FROM k.caso_id
       AND fk.competencia = k.competencia
       AND fk.sequencia = k.kit_sequencia
      LEFT JOIN people.colaboradores cf ON cf.user_id = fk.finalizado_por AND cf.tenant_id = v_tenant
      LEFT JOIN contracts.grupos_impostos gia ON gia.id = NULLIF(fk.ajustes->>'grupo_imposto_id', '')::uuid
  ),
  kit_full AS (
    SELECT k.*,
           ct.cliente_id, cli.nome AS cliente_nome,
           ct.numero AS contrato_numero, ct.nome_contrato AS contrato_nome,
           COALESCE(ct.numero_sequencial, ct.numero) AS contrato_numero_sequencial,
           cs.numero AS caso_numero, cs.nome AS caso_nome,
           COALESCE(cs.enviar_relatorio_timesheet, false) AS enviar_relatorio_timesheet,
           COALESCE(
             NULLIF(cs.regra_cobranca, ''),
             (SELECT NULLIF(r->>'regra_cobranca', '')
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                                               THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
               WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
                 AND NULLIF(r->>'regra_cobranca', '') IS NOT NULL
               LIMIT 1)
           ) AS regra_cobranca,
           -- Grupo/pagadores do CADASTRO (contrato/caso)...
           CASE WHEN gi.id IS NULL THEN NULL
                ELSE jsonb_build_object('id', gi.id, 'nome', gi.nome) END AS grupo_imposto_cadastro,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'cliente_id', pg.cliente_id, 'nome', pc.nome, 'percentual', pg.percentual)
                    ORDER BY pg.percentual DESC, pc.nome)
               FROM (
                 SELECT NULLIF(p.value->>'cliente_id', '')::uuid AS cliente_id,
                        COALESCE(NULLIF(p.value->>'percentual', '')::numeric, 100) AS percentual
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(cs.pagadores_servico) = 'array'
                                AND jsonb_array_length(cs.pagadores_servico) > 0
                               THEN cs.pagadores_servico
                               ELSE jsonb_build_array(jsonb_build_object('cliente_id', ct.cliente_id, 'percentual', 100))
                          END) p
               ) pg
               LEFT JOIN crm.clientes pc ON pc.id = pg.cliente_id
           ), '[]'::jsonb) AS pagadores_cadastro,
           -- ...e o ajuste do kit, quando houver (print 5: vale só neste mês).
           ke.finalizado_em, ke.finalizado_por_nome, ke.finalizado_obs,
           ke.aj_grupo_id, ke.aj_grupo_nome, ke.aj_pagadores,
           nf.id AS nfse_id, nf.numero AS nfse_numero_interno, nf.numero_documento AS nfse_numero_documento,
           nf.nfse_numero, nf.status AS nfse_status,
           nf.focus_status AS nfse_focus_status, nf.arquivo_nome AS nfse_arquivo_nome,
           nf.arquivo_url AS nfse_arquivo_url, nf.valor_total AS nfse_valor_total,
           nf.created_at AS nfse_created_at,
           COALESCE(nf.compartilhada, false) AS nota_compartilhada,
           COALESCE(kns.nfses, '[]'::jsonb) AS nfses_json,
           -- Base do boleto. Kit com serviço (ou que já tem conta da NFS-e):
           -- NFS-e, como sempre. Kit só de despesas: a conta a receber da nota
           -- de débito, quando existe e está viva (07/10). Senão, nada ainda.
           CASE
             WHEN l.id IS NOT NULL OR k.valor_servico > 0 THEN 'nfse'
             WHEN ndl.id IS NOT NULL AND ndl.status <> 'cancelado' THEN 'nota_debito'
             ELSE NULL
           END AS boleto_base,
           -- Conta a receber e boleto "do kit": da NFS-e, ou da ND no kit só de despesas.
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.id ELSE bo.id END AS boleto_id,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.status ELSE bo.status END AS boleto_status,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.vencimento ELSE bo.vencimento END AS boleto_vencimento,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.valor ELSE bo.valor END AS boleto_valor,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.linha_digitavel ELSE bo.linha_digitavel END AS linha_digitavel,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.nosso_numero ELSE bo.nosso_numero END AS nosso_numero,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndb.pix_copia_cola ELSE bo.pix_copia_cola END AS pix_copia_cola,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.id ELSE l.id END AS lanc_id,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END AS lanc_status,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.valor ELSE l.valor END AS lanc_valor,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.vencimento ELSE l.vencimento END AS lanc_vencimento,
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END AS lanc_baixa_data,
           -- Lançamento da ND exposto só quando é ele que sustenta o boleto do kit.
           CASE WHEN l.id IS NULL AND k.valor_servico <= 0 AND ndl.status <> 'cancelado' THEN ndl.id END AS nd_lanc_id,
           env.enviado_em, env.destinatario, env.por AS envio_por, env.erro AS envio_erro,
           env.total AS envio_total, COALESCE(env.algum_ok, false) AS envio_ok,
           -- Boleto vivo em qualquer nota do kit (NFS-e ou ND) trava a devolução.
           (bv.chave IS NOT NULL OR ndbv.chave IS NOT NULL) AS boleto_vivo,
           -- B1: kits deste contrato+competência que ainda cabem numa nota única
           -- (têm serviço e não têm NFS-e viva). Conta o próprio kit; front usa >= 2.
           -- Kit separado (Filipe 16/10) não entra em nota única: a nota do
           -- contrato cobre o kit 1 de cada caso.
           CASE WHEN k.kit_sequencia > 1 THEN 1 ELSE
           count(*) FILTER (
             WHERE k.valor_servico > 0
               AND k.kit_sequencia = 1
               AND NOT COALESCE(nf.status = 'gerado' AND COALESCE(nf.focus_status, '') NOT IN ('erro', 'erro_autorizacao'), false)
           ) OVER (PARTITION BY k.contrato_id, k.competencia) END AS irmaos_no_contrato,
           max(k.kit_sequencia) OVER (PARTITION BY k.grupo) AS ultima_sequencia,
           (gn.primeiro IS NOT NULL AND gn.primeiro < k.kit_sequencia) AS nfse_aguarda_kit_anterior,
           COALESCE(ke.congelado, false) AS congelado,
           CASE
             WHEN (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.status ELSE l.status END) IN ('pago', 'recebido')
               OR (CASE WHEN l.id IS NULL AND k.valor_servico <= 0 THEN ndl.baixa_data ELSE l.baixa_data END) IS NOT NULL
             THEN CASE
                    -- Mais de um pagador: recebido só com TODAS as contas pagas.
                    WHEN COALESCE(kns.n, 0) > 1 AND NOT kns.todas_pagas THEN
                      CASE
                        WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
                        WHEN COALESCE(env.algum_ok, false) THEN 'enviado'
                        WHEN nf.status = 'gerado' AND nf.focus_status IN ('autorizado', 'processando') THEN 'nf_emitida'
                        ELSE 'pendente'
                      END
                    ELSE 'recebido'
                  END
             WHEN ke.finalizado_em IS NOT NULL THEN 'finalizado'
             WHEN COALESCE(env.algum_ok, false) THEN 'enviado'
             WHEN nf.status = 'gerado' AND nf.focus_status IN ('autorizado', 'processando') THEN 'nf_emitida'
             ELSE 'pendente'
           END AS status_kit
      FROM kits k
      JOIN contracts.contratos ct ON ct.id = k.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      LEFT JOIN contracts.casos cs ON cs.id = k.caso_id
      LEFT JOIN contracts.grupos_impostos gi ON gi.id = ct.grupo_imposto_id
      LEFT JOIN kit_nfse nf ON nf.chave = k.chave
      LEFT JOIN kit_lanc l ON l.chave = k.chave
      LEFT JOIN kit_boleto bo ON bo.chave = k.chave
      LEFT JOIN kit_nd_lanc ndl ON ndl.chave = k.chave
      LEFT JOIN kit_nd_boleto ndb ON ndb.chave = k.chave
      LEFT JOIN kit_envio env ON env.chave = k.chave
      LEFT JOIN kit_boleto_vivo bv ON bv.chave = k.chave
      LEFT JOIN kit_nd_boleto_vivo ndbv ON ndbv.chave = k.chave
      LEFT JOIN kit_estado ke ON ke.chave = k.chave
      LEFT JOIN kit_nfses kns ON kns.chave = k.chave
      LEFT JOIN grupo_nfse gn ON gn.grupo = k.grupo
  ),
  filtrado AS (
    SELECT kf.*,
           CASE
             -- Nota única por contrato: devolver um caso desfaria a nota dos outros.
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status IN ('autorizado', 'processando')
                  AND kf.nota_compartilhada
               THEN 'NFS-e conjunta com outros casos'
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status = 'autorizado'
               THEN 'NFS-e ' || COALESCE(kf.nfse_numero, kf.nfse_numero_interno::text) || ' autorizada'
             WHEN kf.nfse_status = 'gerado' AND kf.nfse_focus_status = 'processando'
               THEN 'NFS-e ' || COALESCE(kf.nfse_numero, kf.nfse_numero_interno::text) || ' em processamento'
             WHEN kf.boleto_vivo THEN 'Boleto registrado'
             ELSE NULL
           END AS motivo_bloqueio,
           (kf.aj_grupo_id IS NOT NULL OR kf.aj_pagadores IS NOT NULL) AS ajustes_do_kit,
           -- O que a NFS-e vai usar: o ajuste do kit manda sobre o cadastro.
           CASE WHEN kf.aj_grupo_id IS NOT NULL
                THEN jsonb_build_object('id', kf.aj_grupo_id, 'nome', kf.aj_grupo_nome)
                ELSE kf.grupo_imposto_cadastro END AS grupo_imposto,
           COALESCE(kf.aj_pagadores, kf.pagadores_cadastro) AS pagadores
      FROM kit_full kf
     WHERE (v_competencia IS NULL OR kf.competencia = v_competencia)
       AND (p_cliente_id IS NULL OR kf.cliente_id = p_cliente_id)
       AND (p_contrato_id IS NULL OR kf.contrato_id = p_contrato_id)
       AND (p_caso_id IS NULL OR kf.caso_id = p_caso_id)
       AND (v_regra IS NULL OR kf.regra_cobranca = v_regra)
       AND (v_status IS NULL OR kf.status_kit = v_status)
  ),
  itens_json AS (
    SELECT ic.chave,
           jsonb_agg(jsonb_build_object(
             'id', ic.id,
             'origem_tipo', ic.origem_tipo,
             'descricao', CASE ic.origem_tipo
               WHEN 'timesheet' THEN COALESCE(NULLIF(ic.snapshot->>'timesheet_descricao', ''), 'Timesheet')
               WHEN 'despesa'   THEN COALESCE(NULLIF(ic.snapshot->>'descricao', ''), 'Despesa')
               ELSE COALESCE(NULLIF(ic.snapshot->>'regra_nome', ''),
                             NULLIF(ic.snapshot->>'descricao', ''),
                             NULLIF(ic.snapshot->>'regra_cobranca', ''),
                             'Regra financeira')
             END,
             'data_referencia', ic.data_referencia,
             'horas', ic.horas,
             'valor', ic.valor,
             'status', ic.status,
             'linhas_timesheet', CASE WHEN ic.origem_tipo <> 'timesheet' THEN '[]'::jsonb ELSE
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'data', COALESCE(NULLIF(r->>'data_lancamento', ''), ic.snapshot->>'timesheet_data_lancamento'),
                          'profissional', COALESCE(NULLIF(r->>'profissional', ''), ic.snapshot->>'timesheet_profissional'),
                          'foto_url', (SELECT col.foto_url FROM operations.timesheets t JOIN people.colaboradores col ON col.user_id = t.created_by WHERE t.id = ic.origem_id LIMIT 1),
                          'cargo', NULLIF(r->>'cargo', ''),
                          'descricao', COALESCE(NULLIF(r->>'atividade', ''), NULLIF(r->>'descricao', ''), ic.snapshot->>'timesheet_descricao'),
                          'horas', lh.horas,
                          'valor_hora', lh.valor_hora,
                          'valor', round(lh.horas * lh.valor_hora, 2)
                        ) ORDER BY NULLIF(r->>'data_lancamento', '')::date NULLS LAST)
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(ic.snapshot->'timesheet_itens_revisao') = 'array'
                               THEN ic.snapshot->'timesheet_itens_revisao' ELSE '[]'::jsonb END) r
                   CROSS JOIN LATERAL (
                     SELECT COALESCE(NULLIF(r->>'horas_revisadas', '')::numeric,
                                     NULLIF(r->>'horas', '')::numeric,
                                     NULLIF(r->>'horas_iniciais', '')::numeric, 0) AS horas,
                            COALESCE(NULLIF(r->>'valor_hora', '')::numeric, 0) AS valor_hora
                   ) lh
               ), jsonb_build_array(jsonb_build_object(
                    'data', ic.snapshot->>'timesheet_data_lancamento',
                    'profissional', ic.snapshot->>'timesheet_profissional',
                    'foto_url', (SELECT col.foto_url FROM operations.timesheets t JOIN people.colaboradores col ON col.user_id = t.created_by WHERE t.id = ic.origem_id LIMIT 1),
                    'cargo', NULL,
                    'descricao', ic.snapshot->>'timesheet_descricao',
                    'horas', ic.horas,
                    'valor_hora', COALESCE(NULLIF(ic.snapshot->>'timesheet_valor_hora', '')::numeric,
                                           NULLIF(ic.snapshot->>'valor_hora', '')::numeric,
                                           CASE WHEN ic.horas > 0 THEN round(ic.valor / ic.horas, 2) ELSE 0 END),
                    'valor', ic.valor)))
             END,
             'despesa', CASE WHEN ic.origem_tipo <> 'despesa' THEN NULL ELSE jsonb_build_object(
               'data', COALESCE(NULLIF(ic.snapshot->'valor_itens_revisao'->0->>'referencia', ''), ic.data_referencia::text),
               'categoria', NULLIF(ic.snapshot->>'categoria', ''),
               'descricao', NULLIF(ic.snapshot->>'descricao', ''),
               'valor', ic.valor) END
           ) ORDER BY ic.data_referencia NULLS LAST, ic.created_at) AS itens
      FROM itens_todos ic
     WHERE ic.chave IN (SELECT f.chave FROM filtrado f)
        OR ic.chave IN (SELECT f.grupo || '|pos' FROM filtrado f WHERE f.kit_sequencia = f.ultima_sequencia)
     GROUP BY ic.chave
  ),
  casos_json AS (
    SELECT f.cliente_id, f.cliente_nome, f.valor_total, f.contrato_numero, f.caso_numero,
           jsonb_build_object(
             'chave', f.chave,
             'kit_sequencia', f.kit_sequencia,
             'congelado', f.congelado,
             'nfse_aguarda_kit_anterior', f.nfse_aguarda_kit_anterior,
             -- Aprovados depois de finalizar (Filipe 16/10): vão no último kit
             -- do caso+competência. Unificar = reabrir esse kit, só sem NFS-e
             -- autorizada/processando e sem boleto vivo (motivo_bloqueio).
             'pos_finalizacao', CASE WHEN p.grupo IS NULL THEN NULL ELSE jsonb_build_object(
               'chave', p.grupo || '|pos',
               'itens_count', p.itens,
               'valor_servico', p.valor_servico,
               'valor_despesa', p.valor_despesa,
               'horas', p.horas,
               'lancamentos_timesheet', p.lancamentos_timesheet,
               'valor_total', p.valor_total,
               'itens', COALESCE(pj.itens, '[]'::jsonb),
               'pode_unificar', (f.motivo_bloqueio IS NULL),
               'motivo_nao_unificar', f.motivo_bloqueio) END,
             'caso_id', f.caso_id,
             'caso_numero', f.caso_numero,
             'caso_nome', COALESCE(f.caso_nome, 'Sem caso'),
             'regra_cobranca', f.regra_cobranca,
             'contrato_id', f.contrato_id,
             'contrato_numero', f.contrato_numero,
             'contrato_numero_sequencial', f.contrato_numero_sequencial,
             'contrato_nome', f.contrato_nome,
             'competencia', f.competencia,
             'enviar_relatorio_timesheet', f.enviar_relatorio_timesheet,
             'grupo_imposto', f.grupo_imposto,
             'pagadores', f.pagadores,
             'ajustes_do_kit', f.ajustes_do_kit,
             'ajustes_kit', CASE WHEN NOT f.ajustes_do_kit THEN NULL ELSE jsonb_build_object(
               'grupo_imposto_id', f.aj_grupo_id,
               'grupo_imposto_nome', f.aj_grupo_nome,
               'pagadores', f.aj_pagadores) END,
             'finalizado', CASE WHEN f.finalizado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'em', f.finalizado_em, 'por_nome', f.finalizado_por_nome, 'obs', f.finalizado_obs) END,
             'valor_servico', f.valor_servico,
             'valor_despesa', f.valor_despesa,
             'horas', f.horas,
             'lancamentos_timesheet', f.lancamentos_timesheet,
             'valor_total', f.valor_total,
             'itens', COALESCE(ij.itens, '[]'::jsonb),
             'documentos', jsonb_build_object(
               'nfse', CASE WHEN f.nfse_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', f.nfse_id, 'numero', f.nfse_numero_interno, 'numero_documento', f.nfse_numero_documento,
                 'nfse_numero', f.nfse_numero,
                 'status', f.nfse_status, 'focus_status', f.nfse_focus_status,
                 'arquivo_nome', f.nfse_arquivo_nome, 'arquivo_url', f.nfse_arquivo_url,
                 'valor_total', f.nfse_valor_total, 'created_at', f.nfse_created_at,
                 'compartilhada', f.nota_compartilhada) END,
               'nfses', f.nfses_json,
               'boleto', CASE WHEN f.boleto_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', f.boleto_id, 'status', f.boleto_status, 'vencimento', f.boleto_vencimento,
                 'valor', f.boleto_valor, 'linha_digitavel', f.linha_digitavel,
                 'nosso_numero', f.nosso_numero, 'pix_emv', f.pix_copia_cola) END,
               'relatorio_timesheet', (
                 SELECT jsonb_build_object('id', d.id, 'numero_documento', d.numero_documento,
                                           'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'relatorio_timesheet'),
               'nota_debito', (
                 SELECT jsonb_build_object('id', d.id, 'numero_documento', d.numero_documento,
                                           'gerado_em', d.created_at, 'gerado_por', d.gerado_por,
                                           'arquivo_nome', d.arquivo_nome, 'arquivo_url', d.arquivo_url,
                                           'lancamento_id', f.nd_lanc_id)
                   FROM kit_docs d WHERE d.chave = f.chave AND d.tipo_documento = 'nota_debito')
             ),
             'boleto_base', f.boleto_base,
             'envio', CASE WHEN f.enviado_em IS NULL THEN NULL ELSE jsonb_build_object(
               'enviado_em', f.enviado_em, 'destinatario', f.destinatario, 'por', f.envio_por,
               'erro', f.envio_erro, 'total', f.envio_total) END,
             'conta_receber', CASE WHEN f.lanc_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', f.lanc_id, 'status', f.lanc_status, 'valor', f.lanc_valor,
               'vencimento', f.lanc_vencimento, 'pago_em', f.lanc_baixa_data) END,
             'irmaos_no_contrato', f.irmaos_no_contrato,
             'nota_compartilhada', f.nota_compartilhada,
             'status_kit', f.status_kit,
             'pode_excluir', (f.motivo_bloqueio IS NULL),
             'motivo_bloqueio', f.motivo_bloqueio
           ) AS caso
      FROM filtrado f
      LEFT JOIN itens_json ij ON ij.chave = f.chave
      LEFT JOIN pos p ON p.grupo = f.grupo AND f.kit_sequencia = f.ultima_sequencia
      LEFT JOIN itens_json pj ON pj.chave = f.grupo || '|pos' AND f.kit_sequencia = f.ultima_sequencia
  ),
  clientes_json AS (
    SELECT cj.cliente_id, cj.cliente_nome,
           jsonb_build_object(
             'cliente_id', cj.cliente_id,
             'nome', COALESCE(cj.cliente_nome, 'Cliente sem nome'),
             'valor_total', round(sum(cj.valor_total), 2),
             'kits', count(*),
             'casos', jsonb_agg(cj.caso ORDER BY cj.contrato_numero NULLS LAST, cj.caso_numero NULLS LAST)
           ) AS cliente
      FROM casos_json cj
     GROUP BY cj.cliente_id, cj.cliente_nome
  )
  SELECT jsonb_build_object(
    'resumo', jsonb_build_object(
      'kits', (SELECT count(*) FROM filtrado),
      'valor_total', (SELECT COALESCE(round(sum(valor_total), 2), 0) FROM filtrado),
      'pos_finalizacao', (
        SELECT jsonb_build_object('blocos', count(*), 'itens', COALESCE(sum(p.itens), 0),
                                  'valor', COALESCE(round(sum(p.valor_total), 2), 0))
          FROM filtrado f JOIN pos p ON p.grupo = f.grupo
         WHERE f.kit_sequencia = f.ultima_sequencia),
      'por_status', (
        SELECT jsonb_object_agg(s.status, jsonb_build_object(
                 'kits', COALESCE(t.kits, 0), 'valor', COALESCE(t.valor, 0)))
          FROM (VALUES ('pendente'), ('nf_emitida'), ('enviado'), ('finalizado'), ('recebido')) s(status)
          LEFT JOIN (
            SELECT f.status_kit, count(*) AS kits, round(sum(f.valor_total), 2) AS valor
              FROM filtrado f GROUP BY f.status_kit
          ) t ON t.status_kit = s.status
      )
    ),
    'opcoes', jsonb_build_object(
      'competencias', COALESCE((SELECT jsonb_agg(c ORDER BY c DESC)
                                  FROM (SELECT DISTINCT competencia AS c FROM kit_full) z), '[]'::jsonb),
      'clientes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.cliente_id, 'nome', z.cliente_nome) ORDER BY z.cliente_nome)
                              FROM (SELECT DISTINCT cliente_id, cliente_nome FROM kit_full WHERE cliente_id IS NOT NULL) z), '[]'::jsonb),
      'contratos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.contrato_id, 'numero', z.contrato_numero,
                                                                  'numero_sequencial', z.contrato_numero_sequencial,
                                                                  'nome', z.contrato_nome, 'cliente_id', z.cliente_id)
                                              ORDER BY z.contrato_numero NULLS LAST)
                               FROM (SELECT DISTINCT contrato_id, contrato_numero, contrato_numero_sequencial, contrato_nome, cliente_id FROM kit_full) z), '[]'::jsonb),
      'casos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.caso_id, 'numero', z.caso_numero,
                                                              'nome', z.caso_nome, 'contrato_id', z.contrato_id)
                                          ORDER BY z.caso_numero NULLS LAST)
                           FROM (SELECT DISTINCT caso_id, caso_numero, caso_nome, contrato_id FROM kit_full WHERE caso_id IS NOT NULL) z), '[]'::jsonb),
      'regras', COALESCE((SELECT jsonb_agg(r ORDER BY r)
                            FROM (SELECT DISTINCT regra_cobranca AS r FROM kit_full WHERE regra_cobranca IS NOT NULL) z), '[]'::jsonb)
    ),
    'clientes', COALESCE((SELECT jsonb_agg(c.cliente ORDER BY c.cliente_nome NULLS LAST) FROM clientes_json c), '[]'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END $function$;
-- ── Devolver para revisão: só o kit da tela ──
DROP FUNCTION IF EXISTS public.excluir_kit(uuid, uuid, uuid, date);
CREATE FUNCTION public.excluir_kit(p_user_id uuid, p_caso_id uuid, p_contrato_id uuid, p_competencia date, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_item_ids uuid[];
  v_nota record;
  v_nome text;
  v_itens int := 0;
  v_ts int := 0;
  v_docs int := 0;
  v_nf_erro int := 0;
  v_kit int := 0;
  v_recebiveis int := 0;
  v_seq smallint := COALESCE(p_kit_sequencia, 1)::smallint;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir o kit';
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;

  -- Itens do kit: aprovado/faturado do caso (ou "Sem caso" do contrato) na
  -- competência — mesma regra de competência de get_revisao_fatura.
  -- Filipe 16/10: só os itens DESTE kit (kit_atribuicao). Os aprovados
  -- depois de finalizar e os do kit separado ficam onde estão.
  SELECT array_agg(a.item_id) INTO v_item_ids
    FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = v_competencia
     AND a.kit_sequencia = v_seq
     AND NOT a.pendente;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0,
                              'motivo', 'Nenhum item aprovado neste kit');
  END IF;

  -- Bloqueio 1: NFS-e autorizada ou em processamento sobre esses itens.
  -- Casa por item_ids, não por caso: vale igual para nota de contrato
  -- (caso_id null) que cobre vários casos.
  SELECT bn.id, bn.numero, bn.focus_status, bn.caso_id,
         COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                  NULLIF(bn.metadata->>'nfse_numero', ''),
                  bn.numero::text) AS nfse_numero
    INTO v_nota
    FROM finance.billing_notes bn
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('autorizado', 'processando')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
       WHERE x.value::uuid = ANY (v_item_ids)
     )
   ORDER BY bn.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0,
      'motivo', CASE WHEN v_nota.caso_id IS NULL
                     THEN 'NFS-e ' || v_nota.nfse_numero || ' conjunta com outros casos'
                     WHEN v_nota.focus_status = 'autorizado'
                     THEN 'NFS-e ' || v_nota.nfse_numero || ' autorizada'
                     ELSE 'NFS-e ' || v_nota.nfse_numero || ' em processamento' END);
  END IF;

  -- Bloqueio 2: boleto vivo (registrado/emitido/pago/liquidado) numa conta a
  -- receber de qualquer NFS-e desses itens — inclusive de nota já cancelada,
  -- porque o boleto continua no banco. Idem para a nota de débito do kit
  -- (boleto do kit só de despesas, 07/10).
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE bn.tenant_id = v_tenant
       AND b.status NOT IN ('cancelado', 'erro', 'baixado')
       AND (
         (bn.tipo_documento = 'nota_fiscal_servico' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
           WHERE x.value::uuid = ANY (v_item_ids)))
         OR
         (bn.tipo_documento = 'nota_debito'
          AND bn.contrato_id = p_contrato_id
          AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
          AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq)
       )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0, 'motivo', 'Boleto registrado');
  END IF;

  -- Bloqueio 3: conta a receber da nota de débito já recebida (sem boleto, baixa
  -- manual): devolver os itens apagaria a origem de um dinheiro que entrou.
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_debito'
       AND bn.contrato_id = p_contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
       AND (l.status IN ('pago', 'recebido') OR l.baixa_data IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0, 'motivo', 'Conta a receber da nota de débito já baixada');
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  -- Rastro no histórico do item (mesma tabela que a revisão mostra).
  INSERT INTO finance.revisao_fatura_itens_historico (
    billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
  )
  SELECT bi.id, 'APROVADOR', p_user_id, COALESCE(v_nome, 'Usuário'),
         COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0),
         COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0),
         'Kit excluído da Composição da fatura (competência '
           || to_char(v_competencia, 'MM/YYYY') || '): item devolvido para aprovação (revisão preservada)',
         v_tenant, now()
    FROM finance.billing_items bi
   WHERE bi.id = ANY (v_item_ids);

  -- Volta para a etapa de aprovação (em_aprovacao), NÃO para o início: a
  -- revisão (valor_revisado, horas_revisadas, responsavel_revisao_id,
  -- data_revisao) fica como estava e só a aprovação é limpa. Filipe, 28/09:
  -- "reinicia toda a jornada a partir da aprovação e nunca do lançamento
  -- original, senão perdemos as infos de revisão e aprovação".
  UPDATE finance.billing_items bi
     SET status = 'em_aprovacao',
         valor_aprovado = NULL,
         horas_aprovadas = NULL,
         data_aprovacao = NULL,
         responsavel_aprovacao_id = NULL,
         updated_at = now(),
         updated_by = p_user_id
   WHERE bi.id = ANY (v_item_ids);
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE operations.timesheets t
     SET status = 'revisao', updated_at = now(), updated_by = p_user_id
   WHERE t.tenant_id = v_tenant
     AND t.status = 'aprovado'
     AND t.id IN (
       SELECT bi.origem_id FROM finance.billing_items bi
        WHERE bi.id = ANY (v_item_ids) AND bi.origem_tipo = 'timesheet'
     );
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  -- Conta a receber da nota de débito do kit (sem boleto vivo — já checado
  -- acima) sai junto: a despesa voltou para aprovação, não há o que cobrar.
  UPDATE finance.lancamentos l
     SET status = 'cancelado', updated_at = now()
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento'
     AND l.status NOT IN ('cancelado', 'pago', 'recebido')
     AND l.origem_ref_id IN (
       SELECT bn.id FROM finance.billing_notes bn
        WHERE bn.tenant_id = v_tenant
          AND bn.tipo_documento = 'nota_debito'
          AND bn.contrato_id = p_contrato_id
          AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
          AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
     );
  GET DIAGNOSTICS v_recebiveis = ROW_COUNT;

  -- Documentos do kit (relatório de timesheet, nota de débito) saem junto.
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
     AND bn.status = 'gerado'
     AND bn.contrato_id = p_contrato_id
     AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
     AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  -- NFS-e que ficou em erro sobre esses itens: cancela o registro (não é
  -- ato fiscal — nunca chegou a existir na prefeitura).
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('erro', 'erro_autorizacao')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
       WHERE x.value::uuid = ANY (v_item_ids)
     );
  GET DIAGNOSTICS v_nf_erro = ROW_COUNT;

  -- Estado do kit (finalizado / ajustes) some com o kit (24/09).
  DELETE FROM finance.kits k
   WHERE k.tenant_id = v_tenant
     AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id
     AND k.competencia = v_competencia
     AND k.sequencia = v_seq;
  GET DIAGNOSTICS v_kit = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'itens_devolvidos', v_itens,
    'horas_devolvidas', v_ts,
    'documentos_cancelados', v_docs,
    'recebiveis_cancelados', v_recebiveis,
    'nfse_erro_canceladas', v_nf_erro,
    'kit_apagado', v_kit > 0,
    'motivo', NULL
  );
END $function$;

CREATE OR REPLACE FUNCTION public.excluir_kits(p_user_id uuid, p_kits jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_k jsonb;
  v_res jsonb;
  v_devolvidos int := 0;
  v_recusados jsonb := '[]'::jsonb;
  v_contrato uuid;
  v_caso uuid;
  v_comp date;
  v_seq int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir kits';
  END IF;
  IF p_kits IS NULL OR jsonb_typeof(p_kits) <> 'array' THEN
    RAISE EXCEPTION 'Lista de kits inválida';
  END IF;

  FOR v_k IN SELECT value FROM jsonb_array_elements(p_kits) LOOP
    v_contrato := NULLIF(v_k->>'contrato_id', '')::uuid;
    v_caso := NULLIF(v_k->>'caso_id', '')::uuid;
    v_comp := NULLIF(v_k->>'competencia', '')::date;
    v_seq := COALESCE(NULLIF(v_k->>'kit_sequencia', '')::int, 1);
    BEGIN
      v_res := public.excluir_kit(p_user_id, v_caso, v_contrato, v_comp, v_seq);
    EXCEPTION WHEN OTHERS THEN
      v_res := jsonb_build_object('ok', false, 'motivo', SQLERRM);
    END;

    IF COALESCE((v_res->>'ok')::boolean, false) THEN
      v_devolvidos := v_devolvidos + 1;
    ELSE
      v_recusados := v_recusados || jsonb_build_object(
        'contrato_id', v_contrato, 'caso_id', v_caso, 'competencia', v_comp, 'kit_sequencia', v_seq,
        'motivo', COALESCE(v_res->>'motivo', 'Não foi possível excluir'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'devolvidos', v_devolvidos, 'recusados', v_recusados);
END $function$;

CREATE OR REPLACE FUNCTION public.registrar_documento_kit(p_user_id uuid, p_caso_id uuid, p_contrato_id uuid, p_competencia date, p_tipo text, p_item_ids uuid[], p_arquivo_nome text, p_arquivo_url text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_nome text;
  v_id uuid;
  v_lanc_id uuid;
  v_aviso text;
  v_recebiveis_cancelados int := 0;
  v_travado boolean := false;
  -- ND travada: a anterior segue 'gerado' (sustenta o título) e a nova sai
  -- com o MESMO nº de documento — marcada como reimpressão dela.
  v_reimpressao_de uuid;
  v_numero bigint;
  r record;
  -- Kit separado (Filipe 16/10): documento próprio, não substitui o do kit 1.
  v_seq int := COALESCE(NULLIF(p_metadata->>'kit_sequencia', '')::int, 1);
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para registrar documentos do kit';
  END IF;

  IF p_tipo IS NULL OR p_tipo NOT IN ('relatorio_timesheet', 'nota_debito') THEN
    RAISE EXCEPTION 'Tipo de documento inválido: %', p_tipo;
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos ct WHERE ct.id = p_contrato_id AND ct.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  IF p_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant AND cs.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado no contrato';
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  -- Regerar a nota de débito: a conta a receber da ND anterior sai de cena e
  -- a nova assume — exceto se o título já está no banco (boleto vivo) ou já
  -- foi recebido: aí não se mexe em nada e o front avisa (07/10).
  IF p_tipo = 'nota_debito' THEN
    FOR r IN
      SELECT l.id AS lanc_id, bn.id AS nota_id, bn.metadata->'despesas_no_boleto'->'item_ids' AS item_ids,
             (l.status IN ('pago', 'recebido') OR l.baixa_data IS NOT NULL) AS baixado,
             EXISTS (SELECT 1 FROM finance.boletos b
                      WHERE b.lancamento_id = l.id
                        AND b.status NOT IN ('cancelado', 'erro', 'baixado')) AS boleto_vivo
        FROM finance.billing_notes bn
        JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                  AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
                                  AND l.status <> 'cancelado'
       WHERE bn.tenant_id = v_tenant
         AND bn.tipo_documento = 'nota_debito'
         AND bn.status = 'gerado'
         AND bn.contrato_id = p_contrato_id
         AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
         AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
         AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
    LOOP
      IF r.boleto_vivo OR r.baixado THEN
        v_travado := true;
        v_reimpressao_de := r.nota_id;
        v_aviso := CASE WHEN r.boleto_vivo
                        THEN 'A nota de débito anterior já tem boleto registrado no banco: a conta a receber foi mantida e o novo PDF não gerou outra.'
                        ELSE 'A conta a receber da nota de débito anterior já foi baixada: foi mantida e o novo PDF não gerou outra.' END;
      END IF;
    END LOOP;

    IF NOT v_travado THEN
      FOR r IN
        SELECT l.id AS lanc_id, bn.metadata->'despesas_no_boleto'->'item_ids' AS item_ids
          FROM finance.billing_notes bn
          JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                    AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
                                    AND l.status <> 'cancelado'
         WHERE bn.tenant_id = v_tenant
           AND bn.tipo_documento = 'nota_debito'
           AND bn.status = 'gerado'
           AND bn.contrato_id = p_contrato_id
           AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
           AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
         AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
      LOOP
        UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now() WHERE id = r.lanc_id;
        v_recebiveis_cancelados := v_recebiveis_cancelados + 1;
        -- As despesas que esse recebível tinha marcado como faturadas voltam a
        -- 'aprovado' para o recebível novo somá-las de novo.
        UPDATE finance.billing_items bi
           SET status = 'aprovado', updated_at = now()
         WHERE bi.tenant_id = v_tenant
           AND bi.status = 'faturado'
           AND bi.origem_tipo = 'despesa'
           AND bi.id IN (SELECT x.value::uuid
                           FROM jsonb_array_elements_text(COALESCE(r.item_ids, '[]'::jsonb)) x);
      END LOOP;
    END IF;
  END IF;

  -- Regerar substitui o anterior (mesmo tipo, mesmo kit). Com recebível travado
  -- (boleto vivo/baixa) a ND anterior fica como está: é ela que sustenta o título.
  IF NOT v_travado THEN
    UPDATE finance.billing_notes bn
       SET status = 'cancelado'
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = p_tipo
       AND bn.status = 'gerado'
       AND bn.contrato_id = p_contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
         AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq;
  END IF;

  INSERT INTO finance.billing_notes (
    tenant_id, contrato_id, caso_id, tipo_documento, status,
    arquivo_nome, arquivo_url, metadata, created_by
  ) VALUES (
    v_tenant, p_contrato_id, p_caso_id, p_tipo, 'gerado',
    p_arquivo_nome, p_arquivo_url,
    (COALESCE(p_metadata, '{}'::jsonb) - 'reimpressao_de' - 'kit_sequencia') || jsonb_build_object(
      'item_ids', COALESCE(to_jsonb(p_item_ids), '[]'::jsonb),
      'competencia', v_competencia,
      'gerado_por_nome', COALESCE(v_nome, 'Usuário')
    ) || CASE WHEN v_seq > 1 THEN jsonb_build_object('kit_sequencia', v_seq)
              ELSE '{}'::jsonb END || CASE WHEN v_reimpressao_de IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('reimpressao_de', v_reimpressao_de) END,
    p_user_id
  ) RETURNING id, numero_documento INTO v_id, v_numero;
  -- numero_documento: o trigger trg_set_billing_note_numero_documento resolve
  -- a identidade (tipo, contrato, caso, competência, pagador) — é o mesmo
  -- número que reservar_numero_documento devolveu para imprimir no PDF.

  -- Kit só de despesas ganha conta a receber pela ND (kit com serviço: NULL,
  -- as despesas vão no boleto da NFS-e).
  IF p_tipo = 'nota_debito' AND NOT v_travado THEN
    v_lanc_id := finance.criar_recebivel_da_nota_debito(v_id, p_user_id);
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'lancamento_id', v_lanc_id,
    'recebiveis_cancelados', v_recebiveis_cancelados,
    'aviso', v_aviso,
    'numero_documento', v_numero
  );
END $function$;

DROP FUNCTION IF EXISTS finance.numero_documento_para(uuid, text, uuid, uuid, date, uuid, boolean, uuid);
CREATE FUNCTION finance.numero_documento_para(p_tenant_id uuid, p_tipo text, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_pagador_cliente_id uuid DEFAULT NULL::uuid, p_criar boolean DEFAULT true, p_user_id uuid DEFAULT NULL::uuid, p_kit_sequencia integer DEFAULT 1)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'public'
AS $function$
DECLARE
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_numero bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_tipo IS NULL THEN RETURN NULL; END IF;

  IF NOT p_criar THEN
    SELECT dn.numero INTO v_numero FROM finance.documento_numeros dn
     WHERE dn.tenant_id = p_tenant_id AND dn.tipo_documento = p_tipo
       AND dn.contrato_id IS NOT DISTINCT FROM p_contrato_id
       AND dn.caso_id IS NOT DISTINCT FROM p_caso_id
       AND dn.competencia IS NOT DISTINCT FROM v_competencia
       AND dn.pagador_cliente_id IS NOT DISTINCT FROM p_pagador_cliente_id
       AND dn.kit_sequencia = COALESCE(p_kit_sequencia, 1);
    RETURN v_numero;
  END IF;

  -- Trava o contador do tenant ANTES de procurar: duas reservas simultâneas
  -- da mesma identidade fazem fila aqui, e a segunda acha o número que a
  -- primeira gravou (READ COMMITTED: cada comando vê o que já foi commitado).
  -- Procurar antes de travar deixaria a segunda consumir um número à toa.
  INSERT INTO finance.tenant_counters (tenant_id, key, value)
  VALUES (p_tenant_id, 'documento_numero', 0)
  ON CONFLICT (tenant_id, key) DO NOTHING;

  PERFORM 1 FROM finance.tenant_counters tc
   WHERE tc.tenant_id = p_tenant_id AND tc.key = 'documento_numero'
   FOR UPDATE;

  SELECT dn.numero INTO v_numero FROM finance.documento_numeros dn
   WHERE dn.tenant_id = p_tenant_id AND dn.tipo_documento = p_tipo
     AND dn.contrato_id IS NOT DISTINCT FROM p_contrato_id
     AND dn.caso_id IS NOT DISTINCT FROM p_caso_id
     AND dn.competencia IS NOT DISTINCT FROM v_competencia
     AND dn.pagador_cliente_id IS NOT DISTINCT FROM p_pagador_cliente_id
     AND dn.kit_sequencia = COALESCE(p_kit_sequencia, 1);
  IF v_numero IS NOT NULL THEN RETURN v_numero; END IF;

  UPDATE finance.tenant_counters tc
     SET value = tc.value + 1, updated_at = now()
   WHERE tc.tenant_id = p_tenant_id AND tc.key = 'documento_numero'
  RETURNING tc.value INTO v_numero;

  INSERT INTO finance.documento_numeros (
    tenant_id, numero, tipo_documento, contrato_id, caso_id, competencia, pagador_cliente_id, created_by, kit_sequencia
  ) VALUES (
    p_tenant_id, v_numero, p_tipo, p_contrato_id, p_caso_id, v_competencia, p_pagador_cliente_id, p_user_id,
    COALESCE(p_kit_sequencia, 1)
  );

  RETURN v_numero;
END $function$;

CREATE OR REPLACE FUNCTION finance.set_billing_note_numero_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'public'
AS $function$
DECLARE
  v_competencia date;
  v_pagador uuid;
  v_numero bigint;
  v_seq int := 1;
BEGIN
  IF NEW.numero_documento IS NOT NULL OR NEW.status IS DISTINCT FROM 'gerado' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_pagador := NULLIF(NEW.metadata->>'pagador_cliente_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_pagador := NULL;
  END;

  IF NEW.tipo_documento = 'nota_fiscal_servico' THEN
    -- A NFS-e é gravada DEPOIS que a Focus aceitou (emit-nfse): falhar aqui
    -- perderia o registro de uma nota emitida. Então nada nesta parte aborta
    -- o INSERT — no pior caso a nota fica sem nº de documento.
    IF COALESCE(NEW.focus_status, '') IN ('erro', 'erro_autorizacao', 'cancelado') THEN
      RETURN NEW;
    END IF;
    BEGIN
      -- Mesma competência da Composição: mês do item (periodo_inicio).
      SELECT min(date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date)
        INTO v_competencia
        FROM jsonb_array_elements_text(COALESCE(NEW.metadata->'item_ids', '[]'::jsonb)) x
        JOIN finance.billing_items bi ON bi.id = x.value::uuid AND bi.tenant_id = NEW.tenant_id;
      IF v_competencia IS NULL THEN RETURN NEW; END IF;

      -- Kit separado (Filipe 16/10): a NFS-e é do kit dos itens dela.
      SELECT COALESCE(max(a.kit_sequencia), 1) INTO v_seq
        FROM finance.kit_atribuicao(NEW.tenant_id, NEW.contrato_id) a
       WHERE a.item_id IN (SELECT x.value::uuid
                             FROM jsonb_array_elements_text(COALESCE(NEW.metadata->'item_ids', '[]'::jsonb)) x);

      v_numero := finance.numero_documento_para(
        NEW.tenant_id, NEW.tipo_documento, NEW.contrato_id, NEW.caso_id,
        v_competencia, v_pagador, true, NEW.created_by, v_seq);

      -- Já existe NFS-e viva com esse número (não deveria: os itens já
      -- estariam faturados): a nova fica sem número em vez de quebrar.
      IF EXISTS (
        SELECT 1 FROM finance.billing_notes o
         WHERE o.tenant_id = NEW.tenant_id AND o.numero_documento = v_numero
           AND o.status = 'gerado'
           AND COALESCE(o.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
           AND NOT (o.metadata ? 'reimpressao_de')
      ) THEN
        RAISE WARNING 'NFS-e sem nº de documento: % já está em uso por outra nota viva', v_numero;
        RETURN NEW;
      END IF;

      NEW.numero_documento := v_numero;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'NFS-e sem nº de documento: %', SQLERRM;
      NEW.numero_documento := NULL;
    END;
    RETURN NEW;
  END IF;

  -- Documentos do kit (registrar_documento_kit): a competência vem no metadata.
  BEGIN
    v_competencia := NULLIF(NEW.metadata->>'competencia', '')::date;
  EXCEPTION WHEN others THEN
    v_competencia := NULL;
  END;
  IF v_competencia IS NULL OR NEW.contrato_id IS NULL THEN RETURN NEW; END IF;

  BEGIN
    v_seq := COALESCE(NULLIF(NEW.metadata->>'kit_sequencia', '')::int, 1);
  EXCEPTION WHEN others THEN
    v_seq := 1;
  END;

  NEW.numero_documento := finance.numero_documento_para(
    NEW.tenant_id, NEW.tipo_documento, NEW.contrato_id, NEW.caso_id,
    v_competencia, v_pagador, true, NEW.created_by, v_seq);
  RETURN NEW;
END $function$;

DROP FUNCTION IF EXISTS public.reservar_numero_documento(uuid, uuid, uuid, date, text, uuid, boolean);
CREATE FUNCTION public.reservar_numero_documento(p_user_id uuid, p_caso_id uuid, p_contrato_id uuid, p_competencia date, p_tipo text, p_pagador_cliente_id uuid DEFAULT NULL::uuid, p_reservar boolean DEFAULT true, p_kit_sequencia integer DEFAULT 1)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
BEGIN
  -- Via PostgREST, p_user_id tem de ser quem está logado (não dá para forjar).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para registrar documentos do kit';
  END IF;

  IF p_tipo IS NULL OR p_tipo NOT IN ('relatorio_timesheet', 'nota_debito') THEN
    RAISE EXCEPTION 'Tipo de documento inválido: %', p_tipo;
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos ct WHERE ct.id = p_contrato_id AND ct.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  IF p_caso_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant AND cs.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado no contrato';
  END IF;

  RETURN finance.numero_documento_para(
    v_tenant, p_tipo, p_contrato_id, p_caso_id, v_competencia,
    p_pagador_cliente_id, COALESCE(p_reservar, true), p_user_id, COALESCE(p_kit_sequencia, 1));
END $function$;

CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota(p_nota_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_despesas numeric := 0;
  v_ids uuid[] := '{}';
  v_meses date[] := '{}';
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Nota de débito tem regra própria (kit só de despesas). Antes caía na
  -- regra da NFS-e via cp_sync_faturamento e dobrava o valor.
  IF v_nota.tipo_documento = 'nota_debito' THEN
    RETURN finance.criar_recebivel_da_nota_debito(p_nota_id, p_user_id);
  END IF;

  -- Elegivel? (mesmas condicoes de antes)
  IF v_nota.status <> 'gerado'
     OR NOT (v_nota.focus_ref IS NULL OR v_nota.focus_status = 'autorizado')
     OR COALESCE(NULLIF(v_nota.metadata->>'valor_total','')::numeric, 0) <= 0
     OR EXISTS (SELECT 1 FROM finance.lancamentos l
                 WHERE l.tenant_id = v_nota.tenant_id AND l.origem = 'faturamento'
                   AND l.origem_ref_id = v_nota.id AND l.status <> 'cancelado')
  THEN
    RETURN NULL;
  END IF;

  -- Competência(s) dos itens da nota. A nota de contrato (caso_id null) cobre
  -- um mês (emit-nfse filtra por competência) e as despesas que entram no
  -- boleto dela são as desse mês — não todas as aprovadas do contrato.
  -- focus_request.data_competencia não serve: é a data de emissão.
  SELECT COALESCE(array_agg(DISTINCT date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date), '{}')
    INTO v_meses
    FROM finance.billing_items bi
   WHERE bi.id IN (SELECT x.value::uuid
                     FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x);

  -- Despesas aprovadas do escopo da nota.
  SELECT COALESCE(array_agg(bi.id), '{}'), COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, 0)), 0)
    INTO v_ids, v_despesas
  FROM finance.billing_items bi
  WHERE bi.tenant_id = v_nota.tenant_id
    AND bi.origem_tipo = 'despesa'
    AND bi.status = 'aprovado'
    AND (
      (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
      OR (v_nota.caso_id IS NULL AND bi.contrato_id = v_nota.contrato_id
          AND (cardinality(v_meses) = 0
               OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = ANY (v_meses)))
    )
    -- Filipe 16/10: despesa aprovada depois de finalizar (pendente) não vai
    -- no boleto; e, no caso+mês da nota, só a do kit da nota (o kit separado
    -- tem a sua NFS-e/boleto).
    AND NOT EXISTS (
      SELECT 1
        FROM finance.kit_atribuicao(v_nota.tenant_id, bi.contrato_id) a
       WHERE a.item_id = bi.id
         AND (a.pendente OR EXISTS (
               SELECT 1
                 FROM finance.kit_atribuicao(v_nota.tenant_id, bi.contrato_id) n
                WHERE n.item_id IN (SELECT x.value::uuid
                                      FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x)
                  AND n.caso_id IS NOT DISTINCT FROM a.caso_id
                  AND n.competencia = a.competencia
                  AND n.kit_sequencia IS DISTINCT FROM a.kit_sequencia))
    );

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', COALESCE(NULLIF(v_nota.metadata->>'pagador_cliente_id','')::uuid, ct.cliente_id),
    CASE WHEN v_despesas > 0 THEN 'Honorários e despesas — ' ELSE 'Honorários — ' END
      || COALESCE(cli.nome, 'cliente')
      || COALESCE(' (NF #' || v_nota.numero || ')', ''),
    -- Liquido da nota (bruto - retencoes), nao o bruto (Filipe, 01/10).
    finance.valor_liquido_da_nota(v_nota.metadata) + v_despesas,
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  -- Quem paga e a conta/boleto: o pagador da nota (ajuste no kit/previa), nao o cliente do contrato
  LEFT JOIN crm.clientes cli ON cli.id = COALESCE(NULLIF(v_nota.metadata->>'pagador_cliente_id','')::uuid, ct.cliente_id)
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY(v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', v_despesas, 'lancamento_id', v_id))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota_debito(p_nota_debito_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_competencia date;
  v_item_ids uuid[] := '{}';
  v_ids uuid[] := '{}';
  v_despesas numeric := 0;
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_debito_id;
  IF NOT FOUND OR v_nota.tipo_documento <> 'nota_debito' OR v_nota.status <> 'gerado' THEN
    RETURN NULL;
  END IF;

  v_competencia := date_trunc('month', NULLIF(v_nota.metadata->>'competencia', '')::date)::date;
  IF v_competencia IS NULL THEN RETURN NULL; END IF;

  -- Idempotente: já tem conta a receber viva nesta nota de débito.
  IF EXISTS (
    SELECT 1 FROM finance.lancamentos l
     WHERE l.tenant_id = v_nota.tenant_id AND l.origem = 'faturamento'
       AND l.origem_ref_id = v_nota.id AND l.status <> 'cancelado'
  ) THEN
    RETURN NULL;
  END IF;

  -- Kit COM serviço: as despesas vão no boleto da NFS-e (criar_recebivel_da_nota),
  -- como hoje. "Serviço" é item que não é despesa e VALE alguma coisa — o caso
  -- 360 tem oito lançamentos de timesheet a R$ 0 (horas sem cobrança) e é
  -- justamente o kit que motivou o pedido; só o origem_tipo não basta.
  -- "Kit" = o desta nota de débito (Filipe 16/10: kit separado tem o seu;
  -- serviço aprovado depois de finalizar não conta).
  IF EXISTS (
    SELECT 1 FROM finance.billing_items bi
      JOIN finance.kit_atribuicao(v_nota.tenant_id, v_nota.contrato_id) a ON a.item_id = bi.id
     WHERE bi.tenant_id = v_nota.tenant_id
       AND bi.contrato_id = v_nota.contrato_id
       AND bi.caso_id IS NOT DISTINCT FROM v_nota.caso_id
       AND bi.status IN ('aprovado', 'faturado')
       AND bi.origem_tipo <> 'despesa'
       AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
       AND COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0) > 0
       AND NOT a.pendente
       AND a.kit_sequencia = COALESCE(NULLIF(v_nota.metadata->>'kit_sequencia', '')::int, 1)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(x.value::uuid), '{}') INTO v_item_ids
    FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x;

  -- Despesas aprovadas da nota de débito. 'faturado' fica de fora de propósito:
  -- é a marca de "já está numa conta a receber" (NFS-e ou ND anterior).
  SELECT COALESCE(array_agg(bi.id), '{}'),
         COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)), 0)
    INTO v_ids, v_despesas
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_nota.tenant_id
     AND bi.id = ANY (v_item_ids)
     AND bi.origem_tipo = 'despesa'
     AND bi.status = 'aprovado';

  IF v_despesas <= 0 THEN RETURN NULL; END IF;

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', ct.cliente_id,
    'Despesas — ' || COALESCE(cli.nome, 'cliente') || COALESCE(' (ND #' || v_nota.numero || ')', ''),
    round(v_despesas, 2),
    -- Mesma regra de vencimento da NFS-e (dia de pagamento do caso/contrato,
    -- ou +7 dias); vencimento_override no metadata também vale.
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY (v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', round(v_despesas, 2), 'lancamento_id', v_id))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.get_billing_items_aprovados_escopo(p_tenant_id uuid, p_contrato_id uuid, p_caso_id uuid DEFAULT NULL::uuid, p_competencia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato_cliente uuid;
  v_pagadores jsonb;
  v_tomador_principal uuid;
  v_ids uuid[];
BEGIN
  -- Filipe 16/10: a nota não cobre lançamento aprovado depois de finalizar
  -- (pendente de decisão) e, num caso+mês com kit separado, cobre um kit por
  -- vez — o de menor sequência que ainda tem itens aprovados. A Composição
  -- trava o botão do kit seguinte enquanto o anterior não emite. Sem kit
  -- congelado no grupo, nada muda: todos os aprovados do escopo, como antes.
  SELECT array_agg(e.item_id) INTO v_ids
    FROM (
      SELECT a.item_id, a.kit_sequencia,
             min(a.kit_sequencia) OVER (PARTITION BY a.caso_id, a.competencia) AS primeiro
        FROM finance.kit_atribuicao(p_tenant_id, p_contrato_id) a
        JOIN finance.billing_items bi ON bi.id = a.item_id
       WHERE bi.status = 'aprovado'
         AND bi.origem_tipo <> 'despesa'
         AND NOT a.pendente
         AND (p_caso_id IS NULL OR a.caso_id = p_caso_id)
         AND (p_competencia IS NULL OR a.competencia = date_trunc('month', p_competencia)::date)
    ) e
   WHERE e.kit_sequencia = e.primeiro;
  v_ids := COALESCE(v_ids, '{}');

  SELECT cliente_id INTO v_contrato_cliente
  FROM contracts.contratos WHERE id = p_contrato_id;

  -- Fatias por pagador dos itens aprovados. Para cada item, se o caso tem rateio
  -- (pagadores_servico não vazio) distribui pelo percentual de cada pagador;
  -- senão, 100% para o cliente do contrato.
  WITH aprov AS (
    SELECT bi.id,
           COALESCE(bi.valor_aprovado, bi.valor_revisado, 0)::numeric AS valor,
           ca.pagadores_servico AS pg
    FROM finance.billing_items bi
    LEFT JOIN contracts.casos ca ON ca.id = bi.caso_id
    WHERE bi.tenant_id = p_tenant_id
      AND bi.contrato_id = p_contrato_id
      AND bi.status = 'aprovado'
      -- Despesa e reembolso, nao servico: vai na Nota de Despesas, nunca na
      -- NFS-e. Entrava aqui porque o filtro era so 'aprovado' (Filipe, 07/09,
      -- caso 1949: R$ 75 de despesa somados aos honorarios).
      AND bi.origem_tipo <> 'despesa'
      -- Emissao por CASO: quando p_caso_id vem, a nota cobre so aquele escopo.
      -- Nulo mantem o comportamento de sempre (contrato inteiro), para nao
      -- quebrar quem ja chama a funcao com dois argumentos.
      AND (p_caso_id IS NULL OR bi.caso_id = p_caso_id)
      -- Mes do kit (Filipe, 05/10, caso 41): a nota de outubro somava tambem a
      -- mensalidade de setembro que seguia 'aprovada'. Mesma regra de
      -- competencia da Composicao e da Revisao.
      AND (p_competencia IS NULL OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = date_trunc('month', p_competencia)::date)
      AND bi.id = ANY (v_ids)
  ),
  shares AS (
    SELECT a.id,
           COALESCE((p.value->>'cliente_id')::uuid, v_contrato_cliente) AS payer,
           a.valor * COALESCE((p.value->>'percentual')::numeric, 100) / 100.0 AS fatia
    FROM aprov a
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(a.pg) = 'array' AND jsonb_array_length(a.pg) > 0 THEN a.pg
        ELSE jsonb_build_array(jsonb_build_object('cliente_id', v_contrato_cliente, 'percentual', 100))
      END
    ) AS p(value)
  ),
  agg AS (
    SELECT payer,
           round(sum(fatia), 2) AS valor_total,
           jsonb_agg(DISTINCT id) AS item_ids
    FROM shares
    GROUP BY payer
  )
  SELECT jsonb_agg(jsonb_build_object(
    'cliente_id', payer,
    'cliente', (SELECT to_jsonb(cli) FROM crm.clientes cli WHERE cli.id = payer),
    'valor_total', valor_total,
    'item_ids', item_ids
  ) ORDER BY valor_total DESC)
  INTO v_pagadores
  FROM agg;

  v_pagadores := COALESCE(v_pagadores, '[]'::jsonb);
  v_tomador_principal := COALESCE((v_pagadores->0->>'cliente_id')::uuid, v_contrato_cliente);

  RETURN jsonb_build_object(
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', bi.id, 'caso_id', bi.caso_id,
        'valor', COALESCE(bi.valor_aprovado, bi.valor_revisado, 0),
        'snapshot', bi.snapshot
      ) ORDER BY bi.created_at)
      FROM finance.billing_items bi
      WHERE bi.tenant_id = p_tenant_id AND bi.contrato_id = p_contrato_id AND bi.status = 'aprovado'
        AND bi.origem_tipo <> 'despesa'
        AND (p_caso_id IS NULL OR bi.caso_id = p_caso_id)
        -- Mes do kit (Filipe, 05/10, caso 41): a nota de outubro somava tambem a
        -- mensalidade de setembro que seguia 'aprovada'. Mesma regra de
        -- competencia da Composicao e da Revisao.
        AND (p_competencia IS NULL OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = date_trunc('month', p_competencia)::date)
        AND bi.id = ANY (v_ids)
    ), '[]'::jsonb),
    'contrato', (SELECT to_jsonb(ct) FROM contracts.contratos ct WHERE ct.id = p_contrato_id),
    'tomador', (SELECT to_jsonb(cli) FROM crm.clientes cli WHERE cli.id = v_tomador_principal),
    'grupo_imposto', (SELECT to_jsonb(gi) FROM contracts.grupos_impostos gi WHERE gi.id = (SELECT grupo_imposto_id FROM contracts.contratos WHERE id = p_contrato_id)),
    'pagadores', v_pagadores,
    'pagador_info', jsonb_build_object(
      'contrato_cliente_id', v_contrato_cliente,
      'n_pagadores', jsonb_array_length(v_pagadores),
      'multi', jsonb_array_length(v_pagadores) > 1,
      'tomador_diferente_do_contrato', (v_tomador_principal <> v_contrato_cliente)
    ),
    -- O que existe no contrato e NAO entra nesta nota, por ainda nao estar
    -- aprovado. A nota sempre somou o contrato inteiro, mas so a parte
    -- aprovada — e a tela nao dizia isso, entao quem tinha dois casos e
    -- aprovou um via a nota "nao somar" e parecia bug de agrupamento
    -- (Filipe, 20/08, caso Pattac).
    'pendentes', (
      SELECT jsonb_build_object(
        'itens', COUNT(*),
        'casos', COUNT(DISTINCT bi.caso_id),
        'valor', COALESCE(SUM(COALESCE(bi.valor_revisado, 0)), 0),
        'casos_nomes', COALESCE(jsonb_agg(DISTINCT COALESCE(ca.nome, 'sem caso')), '[]'::jsonb)
      )
      FROM finance.billing_items bi
      LEFT JOIN contracts.casos ca ON ca.id = bi.caso_id
      WHERE bi.tenant_id = p_tenant_id
        AND bi.contrato_id = p_contrato_id
        AND bi.status NOT IN ('aprovado', 'cancelado', 'faturado')
        AND bi.origem_tipo <> 'despesa'
    )
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.get_dados_envio_fatura(uuid, uuid, uuid, date);
CREATE FUNCTION public.get_dados_envio_fatura(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_out jsonb;
  v_nota jsonb;
  v_nota_id uuid;
  v_item_ids uuid[];
  v_envia_ts boolean := false;
  v_anexos jsonb := '[]'::jsonb;
  v_seq int := COALESCE(p_kit_sequencia, 1);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  -- Base (cliente, destinatários, reply_to, permissão) vem da antiga.
  v_out := public.get_dados_envio_fatura(p_user_id, p_contrato_id);

  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;

  -- Itens do kit (para achar a NFS-e certa quando o caso tem mais de uma
  -- competência em aberto).
  IF p_caso_id IS NOT NULL OR v_competencia IS NOT NULL THEN
    -- Só os itens do kit (Filipe 16/10): sem os aprovados depois de
    -- finalizar e sem os do kit separado, a NFS-e achada é a deste kit.
    SELECT array_agg(a.item_id) INTO v_item_ids
      FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
     WHERE (p_caso_id IS NULL OR a.caso_id = p_caso_id)
       AND (v_competencia IS NULL OR a.competencia = v_competencia)
       AND NOT a.pendente
       AND (v_competencia IS NULL OR p_caso_id IS NULL OR a.kit_sequencia = v_seq);

    SELECT jsonb_build_object('id', bn.id, 'numero', bn.numero,
                              'arquivo_nome', bn.arquivo_nome, 'arquivo_url', bn.arquivo_url),
           bn.id
      INTO v_nota, v_nota_id
      FROM finance.billing_notes bn
     WHERE bn.tenant_id = v_tenant
       AND bn.contrato_id = p_contrato_id
       AND bn.tipo_documento = 'nota_fiscal_servico'
       AND bn.status <> 'cancelado'
       AND (p_caso_id IS NULL OR bn.caso_id = p_caso_id)
       AND (
         v_item_ids IS NULL
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
           WHERE x.value::uuid = ANY (v_item_ids))
       )
     ORDER BY bn.created_at DESC
     LIMIT 1;

    v_out := v_out || jsonb_build_object('nota', v_nota);
  ELSE
    v_nota_id := NULLIF(v_out->'nota'->>'id', '')::uuid;
  END IF;

  SELECT COALESCE(cs.enviar_relatorio_timesheet, false) INTO v_envia_ts
    FROM contracts.casos cs WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant;

  -- 1) NFS-e (PDF do Focus).
  IF v_nota_id IS NOT NULL THEN
    SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
             'tipo', 'nfse', 'nome', COALESCE(bn.arquivo_nome, 'nfse.pdf'), 'url', bn.arquivo_url)), v_anexos)
      INTO v_anexos
      FROM finance.billing_notes bn
     WHERE bn.id = v_nota_id AND NULLIF(bn.arquivo_url, '') IS NOT NULL;

    -- 2) Boleto: PDF registrado como boleto_itau ligado à nota (ou ao kit).
    SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
             'tipo', 'boleto', 'nome', COALESCE(b.arquivo_nome, 'boleto.pdf'), 'url', b.arquivo_url,
             'bucket', CASE WHEN b.arquivo_url ~* '^https?://' THEN NULL ELSE 'faturamento-documentos' END)), v_anexos)
      INTO v_anexos
      FROM (
        SELECT bn.arquivo_nome, bn.arquivo_url
          FROM finance.billing_notes bn
         WHERE bn.tenant_id = v_tenant
           AND bn.tipo_documento = 'boleto_itau'
           AND bn.status = 'gerado'
           AND NULLIF(bn.arquivo_url, '') IS NOT NULL
           AND (
             NULLIF(bn.metadata->>'nota_id', '')::uuid = v_nota_id
             OR NULLIF(bn.metadata->>'billing_note_id', '')::uuid = v_nota_id
             OR (bn.contrato_id = p_contrato_id
                 AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
                 AND (v_competencia IS NULL
                      OR NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
                 AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq)
           )
         ORDER BY bn.created_at DESC
         LIMIT 1
      ) b;
  END IF;

  -- 3) Relatório de timesheet (só se o caso pede) e 4) nota de débito.
  SELECT COALESCE(v_anexos || jsonb_agg(jsonb_build_object(
           'tipo', d.tipo_documento, 'nome', COALESCE(d.arquivo_nome, d.tipo_documento || '.pdf'),
           'url', d.arquivo_url,
           'bucket', CASE WHEN d.arquivo_url ~* '^https?://' THEN NULL ELSE 'faturamento-documentos' END)
           ORDER BY d.tipo_documento DESC), v_anexos)
    INTO v_anexos
    FROM (
      SELECT DISTINCT ON (bn.tipo_documento) bn.tipo_documento, bn.arquivo_nome, bn.arquivo_url
        FROM finance.billing_notes bn
       WHERE bn.tenant_id = v_tenant
         AND bn.contrato_id = p_contrato_id
         AND bn.status = 'gerado'
         AND NULLIF(bn.arquivo_url, '') IS NOT NULL
         AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
         AND (v_competencia IS NULL OR NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
         AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = v_seq
         AND (
           bn.tipo_documento = 'nota_debito'
           OR (bn.tipo_documento = 'relatorio_timesheet' AND v_envia_ts)
         )
       ORDER BY bn.tipo_documento, bn.created_at DESC
    ) d;

  RETURN v_out || jsonb_build_object(
    'caso_id', p_caso_id,
    'competencia', v_competencia,
    'kit_sequencia', v_seq,
    'enviar_relatorio_timesheet', v_envia_ts,
    'anexos', v_anexos
  );
END $function$;
-- ── Permissões: as mesmas que as versões antigas tinham ──────────────────
-- DROP + CREATE (assinatura ganhou a sequência do kit, com DEFAULT: quem
-- chama sem ela continua no kit 1) perde os GRANTs e o CREATE dá EXECUTE a
-- PUBLIC. Refaz exatamente o proacl de produção.
REVOKE ALL ON FUNCTION finance._kit_upsert(uuid, uuid, uuid, date, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance._kit_upsert(uuid, uuid, uuid, date, smallint) TO service_role;

REVOKE ALL ON FUNCTION finance.numero_documento_para(uuid, text, uuid, uuid, date, uuid, boolean, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finalizar_kit(uuid, uuid, uuid, date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_kit(uuid, uuid, uuid, date, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reabrir_kit(uuid, uuid, uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_kit(uuid, uuid, uuid, date, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.salvar_ajustes_kit(uuid, uuid, uuid, date, jsonb, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_ajustes_kit(uuid, uuid, uuid, date, jsonb, boolean, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.excluir_kit(uuid, uuid, uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_kit(uuid, uuid, uuid, date, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reservar_numero_documento(uuid, uuid, uuid, date, text, uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_numero_documento(uuid, uuid, uuid, date, text, uuid, boolean, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_dados_envio_fatura(uuid, uuid, uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dados_envio_fatura(uuid, uuid, uuid, date, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decidir_lancamentos_pos_kit(uuid, uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_lancamentos_pos_kit(uuid, uuid, uuid, date, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
