-- Relatório de timesheet consolidado por contrato (Filipe, 16/10: Pattac com
-- seis casos e seis relatórios; Jamute com o fixo no caso 365 e as horas no
-- 1828). Na Composição a pessoa escolhe os kits do mesmo contrato e
-- competência; sai UM PDF, com uma seção por caso, o valor fixo no fim e o
-- total geral.
--
-- Como fica guardado: um nº de documento só — o do contrato (caso NULL), que
-- reservar_numero_documento já sabe reservar — e um registro em CADA kit
-- escolhido, para cada kit mostrar que o relatório existe. O primeiro kit é a
-- via principal; os outros são cópias (metadata.consolidado_de = id da
-- principal), com o mesmo nº. Só a principal vai no e-mail.
--
-- Regerar o relatório de um kit sozinho (registrar_documento_kit) continua
-- valendo: cancela a cópia daquele kit e registra o relatório do caso.

-- O nº de documento é único entre documentos vivos; as cópias do consolidado
-- repetem o nº da principal de propósito.
DROP INDEX IF EXISTS finance.billing_notes_numero_documento_vivo_key;
CREATE UNIQUE INDEX billing_notes_numero_documento_vivo_key ON finance.billing_notes
  USING btree (tenant_id, numero_documento)
  WHERE ((numero_documento IS NOT NULL) AND ((status)::text = 'gerado'::text)
    AND (COALESCE(focus_status, ''::text) <> ALL (ARRAY['erro'::text, 'erro_autorizacao'::text, 'cancelado'::text]))
    AND (NOT (metadata ? 'reimpressao_de'::text))
    AND (NOT (metadata ? 'consolidado_de'::text)));

-- p_kits: [{caso_id, kit_sequencia, item_ids}], na ordem do PDF; o primeiro é
-- a via principal.
CREATE OR REPLACE FUNCTION public.registrar_relatorio_consolidado(
  p_user_id uuid,
  p_contrato_id uuid,
  p_competencia date,
  p_kits jsonb,
  p_arquivo_nome text,
  p_arquivo_url text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_nome text;
  v_numero bigint;
  v_principal uuid;
  v_id uuid;
  v_casos jsonb;
  v_seq int;
  v_ids uuid[] := '{}';
  k jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para registrar documentos do kit';
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos ct WHERE ct.id = p_contrato_id AND ct.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  IF jsonb_typeof(p_kits) IS DISTINCT FROM 'array' OR jsonb_array_length(p_kits) < 2 THEN
    RAISE EXCEPTION 'Escolha pelo menos dois kits do contrato para o relatório consolidado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_kits) x
     WHERE NOT EXISTS (
       SELECT 1 FROM contracts.casos cs
        WHERE cs.id = NULLIF(x->>'caso_id', '')::uuid
          AND cs.tenant_id = v_tenant AND cs.contrato_id = p_contrato_id)
  ) THEN
    RAISE EXCEPTION 'Todos os kits do relatório consolidado precisam ser casos deste contrato';
  END IF;
  IF (SELECT count(DISTINCT (x->>'caso_id', COALESCE(NULLIF(x->>'kit_sequencia', '')::int, 1)))
        FROM jsonb_array_elements(p_kits) x) <> jsonb_array_length(p_kits) THEN
    RAISE EXCEPTION 'Kit repetido no relatório consolidado';
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  -- Nº do contrato (caso NULL): o mesmo que o front reservou para imprimir.
  v_numero := finance.numero_documento_para(
    v_tenant, 'relatorio_timesheet', p_contrato_id, NULL, v_competencia, NULL, true, p_user_id, 1);

  v_casos := (SELECT jsonb_agg(x->>'caso_id' ORDER BY o) FROM jsonb_array_elements(p_kits) WITH ORDINALITY t(x, o));

  -- Regerar: sai o relatório vivo de cada kit escolhido e qualquer via de um
  -- consolidado anterior com este nº (inclusive de kit que saiu da seleção).
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'relatorio_timesheet'
     AND bn.status = 'gerado'
     AND bn.contrato_id = p_contrato_id
     AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia
     AND (
       bn.numero_documento = v_numero
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_kits) x
          WHERE bn.caso_id = NULLIF(x->>'caso_id', '')::uuid
            AND COALESCE(NULLIF(bn.metadata->>'kit_sequencia', '')::int, 1)
                = COALESCE(NULLIF(x->>'kit_sequencia', '')::int, 1))
     );

  FOR k IN SELECT x FROM jsonb_array_elements(p_kits) WITH ORDINALITY t(x, o) ORDER BY o LOOP
    v_seq := COALESCE(NULLIF(k->>'kit_sequencia', '')::int, 1);
    INSERT INTO finance.billing_notes (
      tenant_id, contrato_id, caso_id, tipo_documento, status,
      arquivo_nome, arquivo_url, metadata, created_by, numero_documento
    ) VALUES (
      v_tenant, p_contrato_id, NULLIF(k->>'caso_id', '')::uuid, 'relatorio_timesheet', 'gerado',
      p_arquivo_nome, p_arquivo_url,
      (COALESCE(p_metadata, '{}'::jsonb) - 'kit_sequencia' - 'consolidado_de' - 'reimpressao_de') || jsonb_build_object(
        'item_ids', COALESCE(k->'item_ids', '[]'::jsonb),
        'competencia', v_competencia,
        'gerado_por_nome', COALESCE(v_nome, 'Usuário'),
        'consolidado', jsonb_build_object('casos', v_casos, 'numero_documento', v_numero)
      ) || CASE WHEN v_seq > 1 THEN jsonb_build_object('kit_sequencia', v_seq) ELSE '{}'::jsonb END
        || CASE WHEN v_principal IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('consolidado_de', v_principal) END,
      p_user_id, v_numero
    ) RETURNING id INTO v_id;
    v_principal := COALESCE(v_principal, v_id);
    v_ids := v_ids || v_id;
  END LOOP;

  RETURN jsonb_build_object('id', v_principal, 'ids', to_jsonb(v_ids), 'numero_documento', v_numero);
END $function$;

REVOKE ALL ON FUNCTION public.registrar_relatorio_consolidado(uuid, uuid, date, jsonb, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_relatorio_consolidado(uuid, uuid, date, jsonb, text, text, jsonb) TO authenticated, service_role;

-- E-mail do kit: a cópia do consolidado não vai anexada (só a principal).
CREATE OR REPLACE FUNCTION public.get_dados_envio_fatura(p_user_id uuid, p_contrato_id uuid, p_caso_id uuid, p_competencia date, p_kit_sequencia integer DEFAULT 1)
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
           -- Consolidado (Filipe 16/10): só a via principal vai no e-mail; as
           -- cópias dos outros kits do contrato não repetem o anexo.
           OR (bn.tipo_documento = 'relatorio_timesheet' AND v_envia_ts
               AND NOT (bn.metadata ? 'consolidado_de'))
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
