-- Honorários e despesas em kits separados (Filipe 28/10, Gramarcal).
--
-- "Em 98% dos casos o rateio dos honorários é o mesmo das despesas, e o ERP
-- segue essa premissa; mas há exceções, como a Gramarcal, em que é preciso
-- alterar o pagador especificamente da despesa." O padrão continua "juntos":
-- nada muda para quem não mexe. No kit da Composição, "Separar despesas"
-- tira as despesas para um kit próprio do mesmo caso+competência (a
-- infraestrutura do kit separado de 20261027103000: finance.kits.sequencia,
-- documentos com metadata.kit_sequencia, numeração própria). O kit original
-- fica só com os honorários (NFS-e + boleto sobre ela, sem despesas) e o novo
-- só com as despesas (nota de débito → conta a receber → boleto, 20261007120000),
-- com pagador próprio no ajuste do kit. "Unir de novo" desfaz enquanto
-- nenhum dos dois tiver documento vivo.
--
-- Modelo: finance.kits.conteudo = 'honorarios' | 'despesas' | NULL (juntos).
-- A separação vale quando o grupo (contrato, caso, competência) tem os DOIS:
-- se um deles some (excluir_kit, devolver para revisão), o outro volta a ser
-- um kit comum sozinho — sem precisar mexer em excluir_kit.

ALTER TABLE finance.kits
  ADD COLUMN IF NOT EXISTS conteudo text;
ALTER TABLE finance.kits DROP CONSTRAINT IF EXISTS kits_conteudo_valido;
ALTER TABLE finance.kits ADD CONSTRAINT kits_conteudo_valido
  CHECK (conteudo IS NULL OR conteudo IN ('honorarios', 'despesas'));
COMMENT ON COLUMN finance.kits.conteudo IS
  'Filipe 28/10: honorarios/despesas quando o caso+competência fatura os dois em kits separados (vale com o par completo). NULL = juntos.';

-- ── Em que kit cada item está — agora sabendo a natureza ─────────────────
-- Mesmas regras de 20261027103000; muda só o receptor (kit aberto que recebe
-- os itens livres): num grupo separado, a despesa vai para o kit aberto de
-- despesas (ou sem natureza) e o resto para o de honorários. Sem separação
-- o receptor é o mesmo de antes para todo item.
CREATE OR REPLACE FUNCTION finance.kit_atribuicao(p_tenant uuid, p_contrato_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(item_id uuid, contrato_id uuid, caso_id uuid, competencia date, kit_sequencia smallint, pendente boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH itens AS (
    SELECT bi.id, bi.contrato_id, bi.caso_id,
           date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date AS competencia,
           CASE WHEN bi.origem_tipo = 'despesa' THEN 'despesas' ELSE 'honorarios' END AS classe
      FROM finance.billing_items bi
     WHERE bi.tenant_id = p_tenant
       AND bi.status IN ('aprovado', 'faturado')
       AND (p_contrato_id IS NULL OR bi.contrato_id = p_contrato_id)
  ),
  kits AS (
    SELECT k.contrato_id, k.caso_id, k.competencia, k.sequencia, k.item_ids, k.conteudo
      FROM finance.kits k
     WHERE k.tenant_id = p_tenant
       AND (p_contrato_id IS NULL OR k.contrato_id = p_contrato_id)
  ),
  separado AS (
    SELECT k.contrato_id, k.caso_id, k.competencia
      FROM kits k
     WHERE k.conteudo IS NOT NULL
     GROUP BY k.contrato_id, k.caso_id, k.competencia
    HAVING bool_or(k.conteudo = 'honorarios') AND bool_or(k.conteudo = 'despesas')
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
    SELECT k.contrato_id, k.caso_id, k.competencia, cl.classe, max(k.sequencia) AS sequencia
      FROM kits k
     CROSS JOIN (VALUES ('honorarios'), ('despesas')) cl(classe)
      LEFT JOIN separado s ON s.contrato_id = k.contrato_id
                          AND s.caso_id IS NOT DISTINCT FROM k.caso_id
                          AND s.competencia = k.competencia
     WHERE k.item_ids IS NULL
       AND (s.contrato_id IS NULL OR k.conteudo IS NULL OR k.conteudo = cl.classe)
     GROUP BY k.contrato_id, k.caso_id, k.competencia, cl.classe
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
                        AND r.classe = i.classe
    LEFT JOIN grupo_congelado gc ON gc.contrato_id = i.contrato_id
                                AND gc.caso_id IS NOT DISTINCT FROM i.caso_id
                                AND gc.competencia = i.competencia;
$function$;

REVOKE ALL ON FUNCTION finance.kit_atribuicao(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Natureza de UM kit quando a separação está valendo (par completo); senão NULL.
CREATE OR REPLACE FUNCTION finance._kit_conteudo(p_tenant uuid, p_contrato_id uuid, p_caso_id uuid,
                                                 p_competencia date, p_sequencia integer)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT k.conteudo
    FROM finance.kits k
   WHERE k.tenant_id = p_tenant AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id
     AND k.competencia = date_trunc('month', p_competencia)::date
     AND k.sequencia = p_sequencia
     AND k.conteudo IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM finance.kits o
        WHERE o.tenant_id = k.tenant_id AND o.contrato_id = k.contrato_id
          AND o.caso_id IS NOT DISTINCT FROM k.caso_id
          AND o.competencia = k.competencia
          AND o.conteudo IS NOT NULL AND o.conteudo <> k.conteudo)
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION finance._kit_conteudo(uuid, uuid, uuid, date, integer) FROM PUBLIC, anon, authenticated;

-- Documento vivo de UM kit que impede separar/unir: além do _kit_bloqueio
-- (NFS-e autorizada/processando, boleto vivo), qualquer NFS-e não rejeitada
-- sobre os itens e a nota de débito gerada — mudar o kit depois deixaria o
-- documento cobrindo outra coisa. NULL = livre.
CREATE OR REPLACE FUNCTION finance._kit_doc_vivo(p_tenant uuid, p_contrato_id uuid, p_caso_id uuid,
                                                 p_competencia date, p_sequencia smallint)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'finance', 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_motivo text;
BEGIN
  v_motivo := finance._kit_bloqueio(p_tenant, p_contrato_id, p_caso_id, p_competencia, p_sequencia);
  IF v_motivo IS NOT NULL THEN RETURN v_motivo; END IF;

  SELECT array_agg(a.item_id) INTO v_ids
    FROM finance.kit_atribuicao(p_tenant, p_contrato_id) a
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = p_competencia
     AND a.kit_sequencia = p_sequencia
     AND NOT a.pendente;

  IF EXISTS (
    SELECT 1 FROM finance.billing_notes bn
     WHERE bn.tenant_id = p_tenant
       AND bn.tipo_documento = 'nota_fiscal_servico'
       AND bn.status = 'gerado'
       AND COALESCE(bn.focus_status, '') NOT IN ('erro', 'erro_autorizacao', 'cancelado')
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
                    WHERE x.value::uuid = ANY (COALESCE(v_ids, '{}')))
  ) THEN
    RETURN 'NFS-e emitida';
  END IF;

  IF EXISTS (
    SELECT 1 FROM finance.billing_notes bn
     WHERE bn.tenant_id = p_tenant
       AND bn.tipo_documento = 'nota_debito'
       AND bn.status = 'gerado'
       AND bn.contrato_id = p_contrato_id
       AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
       AND NULLIF(bn.metadata->>'competencia', '')::date = p_competencia
       AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1) = p_sequencia
  ) THEN
    RETURN 'Nota de débito gerada';
  END IF;

  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION finance._kit_doc_vivo(uuid, uuid, uuid, date, smallint) FROM PUBLIC, anon, authenticated;

-- ── Separar despesas ─────────────────────────────────────────────────────
-- O kit p_kit_sequencia (com honorários E despesas, sem documento vivo, não
-- finalizado) vira 'honorarios'; as despesas vão para um kit novo
-- 'despesas', com sequência própria (documentos e número próprios). O kit
-- novo herda o ajuste de impostos/pagadores do original — "nada muda" até a
-- pessoa trocar o pagador dele.
CREATE OR REPLACE FUNCTION public.separar_despesas_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid,
                                                       p_competencia date, p_kit_sequencia integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_seq smallint := COALESCE(p_kit_sequencia, 1)::smallint;
  v_nova smallint;
  v_id uuid;
  v_id_nova uuid;
  v_despesas uuid[];
  v_valor_despesa numeric;
  v_valor_servico numeric;
  v_kit finance.kits%ROWTYPE;
  v_motivo text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para mexer no kit';
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;

  IF EXISTS (
    SELECT 1 FROM finance.kits k
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id AND k.competencia = v_competencia
       AND finance._kit_conteudo(v_tenant, p_contrato_id, p_caso_id, v_competencia, k.sequencia) IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Honorários e despesas deste caso já estão em kits separados.');
  END IF;

  -- "Serviço" como em criar_recebivel_da_nota_debito: item que não é despesa
  -- e vale alguma coisa (timesheet a R$ 0 não faz NFS-e).
  SELECT array_agg(a.item_id) FILTER (WHERE bi.origem_tipo = 'despesa'),
         COALESCE(sum(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0))
                    FILTER (WHERE bi.origem_tipo = 'despesa'), 0),
         COALESCE(sum(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0))
                    FILTER (WHERE bi.origem_tipo <> 'despesa'), 0)
    INTO v_despesas, v_valor_despesa, v_valor_servico
    FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
    JOIN finance.billing_items bi ON bi.id = a.item_id
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = v_competencia
     AND a.kit_sequencia = v_seq
     AND NOT a.pendente;
  IF v_despesas IS NULL OR v_valor_despesa <= 0 OR v_valor_servico <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Só dá para separar um kit que tem honorários e despesas.');
  END IF;

  SELECT * INTO v_kit FROM finance.kits k
   WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id AND k.competencia = v_competencia
     AND k.sequencia = v_seq;
  IF FOUND AND v_kit.finalizado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Kit finalizado: reabra antes de separar as despesas.');
  END IF;

  v_motivo := finance._kit_doc_vivo(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);
  IF v_motivo IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', v_motivo || ': cancele antes de separar as despesas.');
  END IF;

  v_id := finance._kit_upsert(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);
  SELECT * INTO v_kit FROM finance.kits WHERE id = v_id;

  -- Sequência nova: além dos kits, a dos documentos já registrados no grupo
  -- (um kit que foi unido de volta pode ter deixado ND cancelada com o nº dele).
  SELECT GREATEST(
           (SELECT COALESCE(max(k.sequencia), 1) FROM finance.kits k
             WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
               AND k.caso_id IS NOT DISTINCT FROM p_caso_id AND k.competencia = v_competencia),
           (SELECT COALESCE(max(NULLIF(bn.metadata->>'kit_sequencia', '')::int), 1) FROM finance.billing_notes bn
             WHERE bn.tenant_id = v_tenant AND bn.contrato_id = p_contrato_id
               AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
               AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia)
         ) + 1
    INTO v_nova;

  -- Kit congelado (item_ids gravado) continua congelado nos dois lados.
  UPDATE finance.kits
     SET conteudo = 'honorarios',
         item_ids = CASE WHEN item_ids IS NULL THEN NULL
                         ELSE ARRAY(SELECT x FROM unnest(item_ids) x WHERE x <> ALL (v_despesas)) END,
         updated_at = now()
   WHERE id = v_id;

  INSERT INTO finance.kits (tenant_id, contrato_id, caso_id, competencia, sequencia, conteudo, item_ids,
                            ajustes, ajustes_atualizado_em, ajustes_por)
  VALUES (v_tenant, p_contrato_id, p_caso_id, v_competencia, v_nova, 'despesas',
          CASE WHEN v_kit.item_ids IS NULL THEN NULL ELSE v_despesas END,
          v_kit.ajustes, CASE WHEN v_kit.ajustes IS NULL THEN NULL ELSE now() END,
          CASE WHEN v_kit.ajustes IS NULL THEN NULL ELSE p_user_id END)
  RETURNING id INTO v_id_nova;

  RETURN jsonb_build_object(
    'ok', true,
    'kit_sequencia_honorarios', v_seq,
    'kit_sequencia_despesas', v_nova,
    'kit_id_despesas', v_id_nova,
    'despesas', cardinality(v_despesas),
    'valor_despesas', round(v_valor_despesa, 2));
END $function$;
REVOKE ALL ON FUNCTION public.separar_despesas_kit(uuid, uuid, uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.separar_despesas_kit(uuid, uuid, uuid, date, integer) TO authenticated, service_role;

-- ── Unir de novo ─────────────────────────────────────────────────────────
-- Só sem documento vivo nos dois kits e sem nenhum finalizado. O kit de
-- despesas some (as despesas voltam ao de honorários, que volta a "juntos");
-- o ajuste próprio dele (pagador das despesas) vai junto.
CREATE OR REPLACE FUNCTION public.unir_despesas_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid,
                                                    p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_hon finance.kits%ROWTYPE;
  v_desp finance.kits%ROWTYPE;
  v_ids_desp uuid[];
  v_motivo text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para mexer no kit';
  END IF;

  SELECT * INTO v_hon FROM finance.kits k
   WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id AND k.competencia = v_competencia
     AND k.conteudo = 'honorarios'
   ORDER BY k.sequencia DESC LIMIT 1;
  SELECT * INTO v_desp FROM finance.kits k
   WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id AND k.competencia = v_competencia
     AND k.conteudo = 'despesas'
   ORDER BY k.sequencia DESC LIMIT 1;
  IF v_hon.id IS NULL OR v_desp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Honorários e despesas deste caso não estão separados.');
  END IF;

  IF v_hon.finalizado_em IS NOT NULL OR v_desp.finalizado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Kit finalizado: reabra antes de unir honorários e despesas.');
  END IF;
  v_motivo := COALESCE(
    finance._kit_doc_vivo(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_hon.sequencia),
    finance._kit_doc_vivo(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_desp.sequencia));
  IF v_motivo IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', v_motivo || ': cancele antes de unir honorários e despesas.');
  END IF;

  SELECT array_agg(a.item_id) INTO v_ids_desp
    FROM finance.kit_atribuicao(v_tenant, p_contrato_id) a
   WHERE a.caso_id IS NOT DISTINCT FROM p_caso_id
     AND a.competencia = v_competencia
     AND a.kit_sequencia = v_desp.sequencia
     AND NOT a.pendente;

  -- Honorários congelado: as despesas entram no conjunto dele. Aberto: elas
  -- ficam livres e o receptor do grupo (ele) as recebe.
  UPDATE finance.kits
     SET conteudo = NULL,
         item_ids = CASE WHEN item_ids IS NULL THEN NULL
                         ELSE item_ids || COALESCE(v_ids_desp, '{}') END,
         updated_at = now()
   WHERE id = v_hon.id;
  DELETE FROM finance.kits WHERE id = v_desp.id;

  RETURN jsonb_build_object('ok', true, 'kit_sequencia', v_hon.sequencia,
                            'despesas', COALESCE(cardinality(v_ids_desp), 0));
END $function$;
REVOKE ALL ON FUNCTION public.unir_despesas_kit(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unir_despesas_kit(uuid, uuid, uuid, date) TO authenticated, service_role;

-- ── Reabrir: o kit aberto da outra natureza não conta como "outro aberto" ──
CREATE OR REPLACE FUNCTION public.reabrir_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_kit_sequencia integer DEFAULT 1)
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
  v_conteudo text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para reabrir o kit';
  END IF;
  v_conteudo := finance._kit_conteudo(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);

  SELECT EXISTS (
    SELECT 1 FROM finance.kits k
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia
       AND k.sequencia <> v_seq AND k.item_ids IS NULL
       -- Filipe 28/10: com honorários e despesas separados, o kit aberto da
       -- OUTRA natureza não recebe o que é deste — não conta como "outro aberto".
       AND (v_conteudo IS NULL OR k.conteudo IS NULL OR k.conteudo = v_conteudo)
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

-- ── Aprovados depois de finalizar: unificar respeita a natureza ──────────
CREATE OR REPLACE FUNCTION public.decidir_lancamentos_pos_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_acao text)
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
  v_seqs smallint[];
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

  -- Filipe 28/10: com honorários e despesas separados, cada pendente só cabe
  -- no kit da sua natureza — reabrir o kit de despesas não acolhe um
  -- timesheet. Reabre o último kit compatível de cada natureza pendente.
  IF v_acao = 'unificar' AND EXISTS (
    SELECT 1 FROM finance.kits k
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia
       AND finance._kit_conteudo(v_tenant, p_contrato_id, p_caso_id, v_competencia, k.sequencia) IS NOT NULL
  ) THEN
    v_seqs := '{}';
    FOR r IN
      SELECT DISTINCT CASE WHEN bi.origem_tipo = 'despesa' THEN 'despesas' ELSE 'honorarios' END AS classe
        FROM finance.billing_items bi WHERE bi.id = ANY (v_ids)
    LOOP
      SELECT max(k.sequencia) INTO v_seq
        FROM finance.kits k
       WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
         AND k.caso_id IS NOT DISTINCT FROM p_caso_id
         AND k.competencia = v_competencia
         AND (k.conteudo IS NULL OR k.conteudo = r.classe);
      IF v_seq IS NULL THEN CONTINUE; END IF;
      v_motivo := finance._kit_bloqueio(v_tenant, p_contrato_id, p_caso_id, v_competencia, v_seq);
      IF v_motivo IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false,
          'motivo', v_motivo || ' no kit de ' || r.classe || ': não dá para unificar. Fature separado ou postergue.');
      END IF;
      v_seqs := v_seqs || v_seq;
    END LOOP;
    IF cardinality(v_seqs) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'Nenhum kit deste caso aceita esses lançamentos. Fature separado ou postergue.');
    END IF;
    UPDATE finance.kits k
       SET finalizado_em = NULL, finalizado_por = NULL, finalizado_obs = NULL,
           item_ids = NULL, updated_at = now()
     WHERE k.tenant_id = v_tenant AND k.contrato_id = p_contrato_id
       AND k.caso_id IS NOT DISTINCT FROM p_caso_id
       AND k.competencia = v_competencia AND k.sequencia = ANY (v_seqs);
    RETURN jsonb_build_object('ok', true, 'acao', v_acao, 'kit_sequencia', (SELECT max(s) FROM unnest(v_seqs) s),
                              'itens', cardinality(v_ids));
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

-- ── Ajustes: kit de despesas tem um pagador só e não grava no cadastro ───
CREATE OR REPLACE FUNCTION public.salvar_ajustes_kit(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_ajustes jsonb, p_salvar_no_cadastro boolean DEFAULT false, p_kit_sequencia integer DEFAULT 1)
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

  -- Kit só de despesas separado dos honorários (Filipe 28/10, Gramarcal): a
  -- nota de débito gera UMA conta a receber/boleto, então o pagador é um só
  -- (trocável). E os pagadores do cadastro (pagadores_servico) são os dos
  -- honorários — gravar lá o pagador das despesas mudaria a NFS-e dos meses
  -- seguintes.
  IF finance._kit_conteudo(v_tenant, p_contrato_id, p_caso_id, date_trunc('month', p_competencia)::date,
                           COALESCE(p_kit_sequencia, 1)) = 'despesas' THEN
    IF v_pagadores IS NOT NULL AND jsonb_array_length(v_pagadores) > 1 THEN
      RAISE EXCEPTION 'O kit de despesas tem um pagador só (a nota de débito gera um boleto). Escolha um pagador com 100%%.';
    END IF;
    IF p_salvar_no_cadastro THEN
      RAISE EXCEPTION 'O pagador do kit de despesas vale só para este kit: o cadastro do caso guarda os pagadores dos honorários.';
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

-- ── Conta a receber da nota de débito no nome do pagador do kit ──────────
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
  v_pagador uuid;
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

  -- Quem paga (Filipe 28/10, Gramarcal: "alterar o pagador especificamente
  -- da despesa"): o pagador da nota, se veio; senão o pagador ÚNICO
  -- ajustado no kit desta ND (salvar_ajustes_kit). Sem ajuste, o cliente do
  -- contrato, como sempre. Com vários pagadores no ajuste continua o cliente
  -- do contrato: a ND gera uma conta só (ver relatório 28/10).
  v_pagador := NULLIF(v_nota.metadata->>'pagador_cliente_id', '')::uuid;
  IF v_pagador IS NULL THEN
    SELECT NULLIF(k.ajustes->'pagadores'->0->>'cliente_id', '')::uuid INTO v_pagador
      FROM finance.kits k
     WHERE k.tenant_id = v_nota.tenant_id
       AND k.contrato_id = v_nota.contrato_id
       AND k.caso_id IS NOT DISTINCT FROM v_nota.caso_id
       AND k.competencia = v_competencia
       AND k.sequencia = COALESCE(NULLIF(v_nota.metadata->>'kit_sequencia', '')::int, 1)
       AND jsonb_typeof(k.ajustes->'pagadores') = 'array'
       AND jsonb_array_length(k.ajustes->'pagadores') = 1;
  END IF;

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', COALESCE(v_pagador, ct.cliente_id),
    'Despesas — ' || COALESCE(cli.nome, 'cliente') || COALESCE(' (ND #' || v_nota.numero || ')', ''),
    round(v_despesas, 2),
    -- Mesma regra de vencimento da NFS-e (dia de pagamento do caso/contrato,
    -- ou +7 dias); vencimento_override no metadata também vale.
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  LEFT JOIN crm.clientes cli ON cli.id = COALESCE(v_pagador, ct.cliente_id)
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY (v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', round(v_despesas, 2), 'lancamento_id', v_id,
               'pagador_cliente_id', v_pagador))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $function$;
