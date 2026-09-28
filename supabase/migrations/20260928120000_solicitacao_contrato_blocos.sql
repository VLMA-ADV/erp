-- Solicitação de abertura de contrato em blocos (pedido Filipe 28/09).
--
-- O formulário passa a ter: solicitante (colaborador, padrão = quem está
-- logado), bloco "Dados do cliente" (cliente, nome do caso, descrição), bloco
-- "Serviço" (centro de custo com rateio em %, serviço, produto, timesheet,
-- responsável VLMA) e bloco "Financeiro" (regra de cobrança, indicação,
-- contatos do financeiro, arquivos).
--
-- NENHUM campo é obrigatório — nem cliente nem nome do caso. A solicitação é
-- um pedido, não um cadastro: quem monta o contrato completa o que faltar.
-- Sem cliente, cliente_id fica NULL e o inbox mostra "Cliente a definir".
--
-- Rateio e timesheet usam o MESMO formato de contracts.casos
-- (centro_custo_rateio / timesheet_config), para o "Abrir contrato" copiar
-- direto para o caso sem tradução:
--   centro_custo_rateio: [{"centro_custo_id": uuid, "percentual": 60}, ...]
--   timesheet_config:    {"revisores_modo": "auto_centro_custo"}
--                     ou {"revisores_modo": "manual",
--                         "revisores": [{"colaborador_id": uuid, "ordem": 1}]}

ALTER TABLE contracts.solicitacoes_contrato
  ADD COLUMN IF NOT EXISTS solicitante_colaborador_id uuid,
  ADD COLUMN IF NOT EXISTS servico_id uuid,
  ADD COLUMN IF NOT EXISTS produto_id uuid,
  ADD COLUMN IF NOT EXISTS centro_custo_rateio jsonb,
  ADD COLUMN IF NOT EXISTS timesheet_config jsonb;

CREATE OR REPLACE FUNCTION public.create_solicitacao_contrato(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'contracts', 'crm', 'people', 'operations'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_item jsonb;
  v_cliente_id uuid;
  v_cliente_nome text;
  v_nome text;
  v_descricao text;
  v_nome_cliente_novo text;
  v_responsavel_id uuid;
  v_destinatario_id uuid;
  v_solicitante_colaborador_id uuid;
  v_servico_id uuid;
  v_produto_id uuid;
  v_rateio jsonb;
  v_rateio_item jsonb;
  v_rateio_centro_id uuid;
  v_rateio_percentual numeric;
  v_timesheet jsonb;
  v_timesheet_colaborador_id uuid;
  v_cnpj_cliente_novo text;
  v_centro_custo_id uuid;
  v_anexos_count int;
  v_arquivo_nome text;
  v_mime_type text;
  v_tamanho_bytes bigint;
  v_arquivo bytea;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Cliente é opcional (Filipe 28/09): "deixar o mais solto possível". Quando
  -- vier, precisa existir no tenant.
  v_cliente_id := NULLIF(trim(p_payload->>'cliente_id'), '')::uuid;
  IF v_cliente_id IS NOT NULL THEN
    SELECT c.nome INTO v_cliente_nome
    FROM crm.clientes c
    WHERE c.id = v_cliente_id AND c.tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente não encontrado';
    END IF;
  END IF;

  -- Nome também opcional. Sem nome, a solicitação recebe o nome do cliente
  -- (se houver) para continuar identificável na lista.
  v_nome := NULLIF(trim(p_payload->>'nome'), '');
  v_nome := COALESCE(v_nome, v_cliente_nome, 'Solicitação sem nome');
  v_descricao := NULLIF(trim(p_payload->>'descricao'), '');
  v_descricao := COALESCE(v_descricao, v_nome);
  v_nome_cliente_novo := p_payload->>'nome_cliente_novo';
  v_cnpj_cliente_novo := p_payload->>'cnpj_cliente_novo';
  v_anexos_count := COALESCE(jsonb_array_length(COALESCE(p_payload->'anexos', '[]'::jsonb)), 0);

  -- Solicitante: colaborador escolhido no topo do formulário. Sem escolha,
  -- é o colaborador do usuário logado (padrão do select).
  v_solicitante_colaborador_id := NULLIF(trim(p_payload->>'solicitante_colaborador_id'), '')::uuid;
  IF v_solicitante_colaborador_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM people.colaboradores co
    WHERE co.id = v_solicitante_colaborador_id AND co.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Solicitante não encontrado';
  END IF;
  IF v_solicitante_colaborador_id IS NULL THEN
    SELECT co.id INTO v_solicitante_colaborador_id
    FROM people.colaboradores co
    WHERE co.user_id = p_user_id AND co.tenant_id = v_tenant_id
    LIMIT 1;
  END IF;

  -- Serviço (operations.categorias_servico) e produto (contracts.produtos):
  -- mesmas listas do cadastro de caso.
  v_servico_id := NULLIF(trim(p_payload->>'servico_id'), '')::uuid;
  IF v_servico_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM operations.categorias_servico s
    WHERE s.id = v_servico_id AND s.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Serviço não encontrado';
  END IF;

  v_produto_id := NULLIF(trim(p_payload->>'produto_id'), '')::uuid;
  IF v_produto_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contracts.produtos pr
    WHERE pr.id = v_produto_id AND pr.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  -- Rateio de centro de custo, no formato de contracts.casos. Linhas sem
  -- centro são ignoradas; percentuais fora de 0..100 são rejeitados. Não
  -- exige fechar em 100%: é um pedido, quem monta o contrato ajusta.
  v_rateio := '[]'::jsonb;
  IF jsonb_typeof(p_payload->'centro_custo_rateio') = 'array' THEN
    FOR v_rateio_item IN SELECT value FROM jsonb_array_elements(p_payload->'centro_custo_rateio')
    LOOP
      v_rateio_centro_id := NULLIF(trim(v_rateio_item->>'centro_custo_id'), '')::uuid;
      IF v_rateio_centro_id IS NULL THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM people.areas a
        WHERE a.id = v_rateio_centro_id AND a.tenant_id = v_tenant_id
      ) THEN
        RAISE EXCEPTION 'Centro de custo não encontrado';
      END IF;
      v_rateio_percentual := COALESCE(NULLIF(trim(v_rateio_item->>'percentual'), ''), '0')::numeric;
      IF v_rateio_percentual < 0 OR v_rateio_percentual > 100 THEN
        RAISE EXCEPTION 'Percentual do centro de custo deve ficar entre 0 e 100';
      END IF;
      v_rateio := v_rateio || jsonb_build_array(jsonb_build_object(
        'centro_custo_id', v_rateio_centro_id,
        'percentual', v_rateio_percentual
      ));
    END LOOP;
  END IF;

  -- centro_custo_id (coluna antiga, single) continua preenchido para quem lê
  -- só ele: vira o centro de maior percentual do rateio. E o caminho inverso:
  -- quem mandou só centro_custo_id (CRM antigo) ganha rateio de 100%.
  v_centro_custo_id := NULLIF(trim(p_payload->>'centro_custo_id'), '')::uuid;
  IF jsonb_array_length(v_rateio) > 0 THEN
    SELECT (e->>'centro_custo_id')::uuid INTO v_centro_custo_id
    FROM jsonb_array_elements(v_rateio) e
    ORDER BY (e->>'percentual')::numeric DESC
    LIMIT 1;
  ELSIF v_centro_custo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM people.areas a
      WHERE a.id = v_centro_custo_id AND a.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Centro de custo não encontrado';
    END IF;
    v_rateio := jsonb_build_array(jsonb_build_object(
      'centro_custo_id', v_centro_custo_id, 'percentual', 100
    ));
  END IF;
  IF jsonb_array_length(v_rateio) = 0 THEN
    v_rateio := NULL;
  END IF;

  -- Timesheet: "algum usuário ou proporcional ao centro de custo", no formato
  -- de contracts.casos.timesheet_config (revisores_modo + revisores).
  v_timesheet := NULL;
  IF jsonb_typeof(p_payload->'timesheet_config') = 'object' THEN
    IF p_payload->'timesheet_config'->>'revisores_modo' = 'auto_centro_custo' THEN
      v_timesheet := jsonb_build_object('revisores_modo', 'auto_centro_custo', 'revisores', '[]'::jsonb);
    ELSIF jsonb_typeof(p_payload->'timesheet_config'->'revisores') = 'array'
      AND jsonb_array_length(p_payload->'timesheet_config'->'revisores') > 0 THEN
      v_timesheet_colaborador_id := NULLIF(trim(p_payload->'timesheet_config'->'revisores'->0->>'colaborador_id'), '')::uuid;
      IF v_timesheet_colaborador_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM people.colaboradores co
          WHERE co.id = v_timesheet_colaborador_id AND co.tenant_id = v_tenant_id
        ) THEN
          RAISE EXCEPTION 'Colaborador do timesheet não encontrado';
        END IF;
        v_timesheet := jsonb_build_object(
          'revisores_modo', 'manual',
          'revisores', jsonb_build_array(jsonb_build_object(
            'colaborador_id', v_timesheet_colaborador_id, 'ordem', 1
          ))
        );
      END IF;
    END IF;
  END IF;

  -- Responsavel VLMA e destinatario sao listas do proprio sistema, nao texto
  -- livre: texto livre nunca casa com o cadastro e o dado nao serve pra nada.
  -- Os dois sao opcionais — o destinatario so existe quando o solicitante quer
  -- dirigir o pedido a alguem (Filipe, 07/08).
  v_responsavel_id := NULLIF(p_payload->>'responsavel_vlma_id', '')::uuid;
  IF v_responsavel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM people.colaboradores co WHERE co.id = v_responsavel_id AND co.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Responsável não encontrado';
  END IF;

  v_destinatario_id := NULLIF(p_payload->>'destinatario_user_id', '')::uuid;
  IF v_destinatario_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM people.colaboradores co WHERE co.user_id = v_destinatario_id AND co.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Destinatário não encontrado';
  END IF;

  -- IMPORTANTE: NÃO cria contrato automático.
  -- contrato_id permanece NULL — solicitação fica disponível no inbox para
  -- o "Abrir contrato" manual, que leva os campos para o caso.
  INSERT INTO contracts.solicitacoes_contrato (
    tenant_id,
    nome,
    descricao,
    status,
    cliente_id,
    contrato_id,
    solicitante_user_id,
    created_by,
    updated_by,
    nome_cliente_novo,
    cnpj_cliente_novo,
    centro_custo_id,
    responsavel_vlma_id,
    regra_cobranca_texto,
    indicacao_cross_sell,
    contatos_financeiro,
    destinatario_user_id,
    solicitante_colaborador_id,
    servico_id,
    produto_id,
    centro_custo_rateio,
    timesheet_config
  ) VALUES (
    v_tenant_id,
    v_nome,
    v_descricao,
    'aberta',
    v_cliente_id,
    NULL,
    p_user_id,
    p_user_id,
    p_user_id,
    v_nome_cliente_novo,
    v_cnpj_cliente_novo,
    v_centro_custo_id,
    v_responsavel_id,
    NULLIF(trim(p_payload->>'regra_cobranca_texto'), ''),
    NULLIF(trim(p_payload->>'indicacao_cross_sell'), ''),
    NULLIF(trim(p_payload->>'contatos_financeiro'), ''),
    v_destinatario_id,
    v_solicitante_colaborador_id,
    v_servico_id,
    v_produto_id,
    v_rateio,
    v_timesheet
  ) RETURNING id INTO v_id;

  -- Anexos: persiste APENAS em solicitacoes_contrato_anexos (não espelha em
  -- contrato_anexos pois não há contrato).
  IF v_anexos_count > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'anexos', '[]'::jsonb))
    LOOP
      IF NULLIF(v_item->>'nome', '') IS NULL OR NULLIF(v_item->>'arquivo_base64', '') IS NULL THEN
        CONTINUE;
      END IF;

      v_arquivo_nome := COALESCE(NULLIF(v_item->>'arquivo_nome', ''), 'anexo.bin');
      v_mime_type := NULLIF(v_item->>'mime_type', '');
      v_tamanho_bytes := NULLIF(v_item->>'tamanho_bytes', '')::bigint;
      v_arquivo := decode(v_item->>'arquivo_base64', 'base64');

      INSERT INTO contracts.solicitacoes_contrato_anexos (
        tenant_id,
        solicitacao_id,
        nome,
        arquivo_nome,
        mime_type,
        tamanho_bytes,
        arquivo,
        created_by
      ) VALUES (
        v_tenant_id,
        v_id,
        'Proposta',
        v_arquivo_nome,
        v_mime_type,
        v_tamanho_bytes,
        v_arquivo,
        p_user_id
      );
    END LOOP;
  END IF;

  -- Conversão via CRM: leva os anexos da proposta (card) junto para a
  -- solicitação — antes eles ficavam para trás (feedback 20/07).
  IF NULLIF(p_payload->>'origem_card_id', '') IS NOT NULL THEN
    INSERT INTO contracts.solicitacoes_contrato_anexos (
      tenant_id, solicitacao_id, nome, arquivo_nome, mime_type, tamanho_bytes, arquivo, created_by
    )
    SELECT v_tenant_id, v_id, COALESCE(NULLIF(a.nome, ''), 'Proposta'), a.arquivo_nome, a.mime_type, a.tamanho_bytes, a.arquivo, p_user_id
    FROM crm.pipeline_card_anexos a
    WHERE a.card_id = (p_payload->>'origem_card_id')::uuid
      AND a.tenant_id = v_tenant_id
      AND a.arquivo IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM contracts.solicitacoes_contrato_anexos s
        WHERE s.solicitacao_id = v_id AND s.arquivo_nome = a.arquivo_nome
      );
  END IF;

  RETURN jsonb_build_object('id', v_id, 'contrato_id', NULL);
END;
$function$;

-- Lista/inbox: devolve os campos novos já com nomes resolvidos, para a tela
-- não precisar cruzar com outras listas. solicitante_nome passa a vir do
-- colaborador escolhido no formulário; cai no colaborador do usuário que
-- gravou quando a solicitação é antiga (sem solicitante_colaborador_id).
CREATE OR REPLACE FUNCTION public.get_solicitacoes_contrato(p_user_id uuid, p_only_unread boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_is_manager boolean;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  v_is_manager := public.is_admin_or_socio(p_user_id, v_tenant_id);

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'descricao', s.descricao,
        'status', s.status,
        'cliente_id', COALESCE(s.cliente_id, c.cliente_id),
        'cliente_nome', COALESCE(cli.nome, cli_contrato.nome),
        'contrato_id', s.contrato_id,
        'contrato_numero', c.numero,
        'contrato_numero_sequencial', c.numero_sequencial,
        'contrato_nome', c.nome_contrato,
        'nome', s.nome,
        'solicitante_user_id', s.solicitante_user_id,
        'solicitante_colaborador_id', COALESCE(s.solicitante_colaborador_id, col.id),
        'solicitante_nome', COALESCE(solc.nome, col.nome),
        'solicitante_foto', COALESCE(solc.foto_url, col.foto_url),
        -- Campos que quem monta o contrato precisa ler (Filipe 07/08).
        'centro_custo_id', s.centro_custo_id,
        'centro_custo_nome', ar.nome,
        'responsavel_vlma_id', s.responsavel_vlma_id,
        'responsavel_vlma_nome', resp.nome,
        'regra_cobranca_texto', s.regra_cobranca_texto,
        'indicacao_cross_sell', s.indicacao_cross_sell,
        'contatos_financeiro', s.contatos_financeiro,
        'destinatario_user_id', s.destinatario_user_id,
        'destinatario_nome', dest.nome,
        -- Bloco "Serviço" (Filipe 28/09).
        'servico_id', s.servico_id,
        'servico_nome', srv.nome,
        'produto_id', s.produto_id,
        'produto_nome', prod.nome,
        'centro_custo_rateio', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'centro_custo_id', e->>'centro_custo_id',
            'centro_custo_nome', ra.nome,
            'percentual', (e->>'percentual')::numeric
          ) ORDER BY (e->>'percentual')::numeric DESC, ra.nome)
          FROM jsonb_array_elements(COALESCE(s.centro_custo_rateio, '[]'::jsonb)) e
          LEFT JOIN people.areas ra
            ON ra.id = NULLIF(e->>'centro_custo_id', '')::uuid AND ra.tenant_id = s.tenant_id
        ), '[]'::jsonb),
        'timesheet_config', s.timesheet_config,
        'timesheet_descricao', CASE
          WHEN s.timesheet_config->>'revisores_modo' = 'auto_centro_custo'
            THEN 'Proporcional ao centro de custo'
          ELSE (
            SELECT tsc.nome
            FROM people.colaboradores tsc
            WHERE tsc.tenant_id = s.tenant_id
              AND tsc.id = NULLIF(s.timesheet_config->'revisores'->0->>'colaborador_id', '')::uuid
          )
        END,
        'providenciada_em', s.providenciada_em,
        'concluida_em', s.concluida_em,
        'lido_at', s.lido_at,
        'created_at', s.created_at,
        'anexos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id,
            'nome', a.nome,
            'arquivo_nome', a.arquivo_nome,
            'mime_type', a.mime_type,
            'tamanho_bytes', a.tamanho_bytes,
            'created_at', a.created_at
          ) ORDER BY a.created_at DESC)
          FROM contracts.solicitacoes_contrato_anexos a
          WHERE a.solicitacao_id = s.id
        ), '[]'::jsonb)
      )
      ORDER BY s.created_at DESC
    )
    FROM contracts.solicitacoes_contrato s
    LEFT JOIN contracts.contratos c ON c.id = s.contrato_id AND c.tenant_id = s.tenant_id
    LEFT JOIN crm.clientes cli ON cli.id = s.cliente_id AND cli.tenant_id = s.tenant_id
    LEFT JOIN crm.clientes cli_contrato ON cli_contrato.id = c.cliente_id AND cli_contrato.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores col ON col.user_id = s.solicitante_user_id AND col.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores solc ON solc.id = s.solicitante_colaborador_id AND solc.tenant_id = s.tenant_id
    LEFT JOIN people.areas ar ON ar.id = s.centro_custo_id AND ar.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores resp ON resp.id = s.responsavel_vlma_id AND resp.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores dest ON dest.user_id = s.destinatario_user_id AND dest.tenant_id = s.tenant_id
    LEFT JOIN operations.categorias_servico srv ON srv.id = s.servico_id AND srv.tenant_id = s.tenant_id
    LEFT JOIN contracts.produtos prod ON prod.id = s.produto_id AND prod.tenant_id = s.tenant_id
    WHERE s.tenant_id = v_tenant_id
      -- Quem foi apontado como solicitante também vê a solicitação, mesmo
      -- que outra pessoa tenha preenchido o formulário por ela.
      AND (v_is_manager OR s.solicitante_user_id = p_user_id OR solc.user_id = p_user_id)
      AND (NOT p_only_unread OR s.lido_at IS NULL)
  ), '[]'::jsonb);
END;
$function$;
