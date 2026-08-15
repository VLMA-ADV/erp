-- =====================================================================
-- BOLETO ITAÚ — base de dados (config + registro + baixa por webhook)
--
-- Contexto: o Itaú mandou em 14/08/2026 o pacote de integração (coleção
-- Postman "Boletos", cobrança API v2). O certificado mTLS ainda não existe
-- — o token temporário para gerar o CSR venceu em 02/06/2026 — e seis
-- decisões de negócio (juros, multa, desconto, protesto, negativação, data
-- limite) ainda estão com o escritório.
--
-- Esta migration existe justamente por causa disso: TUDO o que ainda não foi
-- decidido vira CONFIGURAÇÃO em finance.boleto_config, não constante no
-- código. Quando o Filipe responder "multa de 2%, juros de 1% ao mês", é
-- preencher um formulário — não é refazer a integração. Era o pedido dele:
-- "vamos implementar tudo de uma vez para nao ter retrabalho".
--
-- Convenções do projeto seguidas: schema de domínio, tenant_id NOT NULL,
-- RLS ligada SEM policy (o acesso é só por RPC SECURITY DEFINER), numeric(14,2).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. CONFIGURAÇÃO POR TENANT
-- ─────────────────────────────────────────────────────────────────────
--
-- Nada de credencial aqui. client_id, client_secret, certificado e chave
-- privada moram em variável de ambiente da edge function (ITAU_CLIENT_ID,
-- ITAU_CLIENT_SECRET, ITAU_CERT_PEM, ITAU_KEY_PEM). Guardar segredo em tabela
-- de aplicação é o tipo de coisa que a auditoria de julho apontou; não se
-- repete aqui.
CREATE TABLE IF NOT EXISTS finance.boleto_config (
  tenant_id                 uuid PRIMARY KEY,
  ativo                     boolean NOT NULL DEFAULT false,

  -- Dados da conta de cobrança, fornecidos pelo Itaú.
  id_beneficiario           text,
  codigo_carteira           text NOT NULL DEFAULT '109',
  codigo_especie            text NOT NULL DEFAULT '01',

  -- Faixa de nosso número cedida pelo banco. O contador anda dentro dela;
  -- estourar o fim é erro, não é "dá a volta" — repetir nosso número dentro
  -- da mesma carteira gera boleto duplicado no banco.
  nosso_numero_inicio       bigint NOT NULL DEFAULT 1,
  nosso_numero_fim          bigint NOT NULL DEFAULT 99999999,

  -- ── as seis decisões pendentes do escritório ───────────────────────
  -- Default = sem encargo e sem protesto. É o comportamento mais conservador:
  -- um boleto que cobra a menos é um problema comercial; um que cobra juros
  -- que o cliente nunca combinou é um problema jurídico.
  multa_tipo                text NOT NULL DEFAULT 'isento',  -- isento | valor | percentual
  multa_valor               numeric(14,2),
  multa_percentual          numeric(9,5),
  multa_dias                integer NOT NULL DEFAULT 1,

  juros_ativo               boolean NOT NULL DEFAULT false,
  juros_codigo_tipo         text NOT NULL DEFAULT '90',
  juros_percentual_mes      numeric(9,5),
  juros_dias                integer NOT NULL DEFAULT 1,

  desconto_expresso         boolean NOT NULL DEFAULT false,

  protesto_ativo            boolean NOT NULL DEFAULT false,
  protesto_codigo_tipo      integer,
  protesto_dias             integer,

  negativacao_ativo         boolean NOT NULL DEFAULT false,
  negativacao_codigo_tipo   integer,
  negativacao_dias          integer,

  -- Dias após o vencimento em que o boleto para de aceitar pagamento.
  -- NULL = sem limite (o banco usa o padrão dele).
  dias_limite_pagamento     integer,

  -- Instruções impressas na ficha. [{codigo, dias_apos_vencimento, dia_util}]
  instrucoes                jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- "01" autoriza recebimento divergente; NULL omite o bloco.
  recebimento_divergente    text DEFAULT '01',

  -- Quem entrega o boleto ao cliente: 'escritorio' (anexo no e-mail da fatura,
  -- como é hoje) ou 'itau' (o banco manda por e-mail). Decisão pendente.
  forma_envio               text NOT NULL DEFAULT 'escritorio',

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT boleto_config_multa_tipo_chk
    CHECK (multa_tipo IN ('isento', 'valor', 'percentual')),
  CONSTRAINT boleto_config_forma_envio_chk
    CHECK (forma_envio IN ('escritorio', 'itau')),
  CONSTRAINT boleto_config_faixa_chk
    CHECK (nosso_numero_fim > nosso_numero_inicio),
  -- Coerência: escolheu cobrar multa, tem de dizer quanto.
  CONSTRAINT boleto_config_multa_valor_chk
    CHECK (multa_tipo <> 'valor' OR multa_valor IS NOT NULL),
  CONSTRAINT boleto_config_multa_pct_chk
    CHECK (multa_tipo <> 'percentual' OR multa_percentual IS NOT NULL),
  CONSTRAINT boleto_config_juros_chk
    CHECK (NOT juros_ativo OR juros_percentual_mes IS NOT NULL)
);

ALTER TABLE finance.boleto_config ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- 2. BOLETOS EMITIDOS
-- ─────────────────────────────────────────────────────────────────────
--
-- Um boleto por lançamento a receber. payload_enviado e resposta ficam
-- gravados porque, quando o cliente ligar dizendo que o valor está errado,
-- a pergunta é sempre "o que exatamente foi mandado ao banco naquele dia".
CREATE TABLE IF NOT EXISTS finance.boletos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  lancamento_id     uuid NOT NULL REFERENCES finance.lancamentos (id) ON DELETE CASCADE,

  nosso_numero      text NOT NULL,
  seu_numero        text NOT NULL,
  valor             numeric(14,2) NOT NULL,
  vencimento        date NOT NULL,

  status            text NOT NULL DEFAULT 'preparado',
  -- preparado  -> nosso número reservado, ainda não foi ao banco
  -- registrado -> o Itaú aceitou; tem código de barras
  -- erro       -> o Itaú recusou; erro_mensagem explica
  -- liquidado  -> o webhook avisou que foi pago
  -- baixado    -> baixa operacional/cancelamento no banco

  id_boleto         text,      -- identificador do Itaú
  codigo_barras     text,
  linha_digitavel   text,
  pix_copia_cola    text,

  payload_enviado   jsonb,
  resposta          jsonb,
  erro_mensagem     text,

  valor_pago        numeric(14,2),
  data_credito      date,
  notificacao       jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,

  CONSTRAINT boletos_status_chk
    CHECK (status IN ('preparado', 'registrado', 'erro', 'liquidado', 'baixado')),
  -- Dentro do tenant o nosso número é único. É o que impede o mesmo título
  -- de ser registrado duas vezes no banco por dois cliques seguidos.
  UNIQUE (tenant_id, nosso_numero)
);

CREATE INDEX IF NOT EXISTS idx_boletos_tenant_lanc ON finance.boletos (tenant_id, lancamento_id);
CREATE INDEX IF NOT EXISTS idx_boletos_tenant_status ON finance.boletos (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_boletos_id_boleto ON finance.boletos (id_boleto) WHERE id_boleto IS NOT NULL;

-- Um lançamento só pode ter UM boleto vivo. Um segundo boleto para a mesma
-- cobrança significa o cliente recebendo duas fichas do mesmo valor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_boletos_lancamento_vivo
  ON finance.boletos (lancamento_id)
  WHERE status IN ('preparado', 'registrado', 'liquidado');

ALTER TABLE finance.boletos ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- 3. RPCs
-- ─────────────────────────────────────────────────────────────────────

-- Permissão: emitir boleto é cobrar o cliente, o mesmo ato de emitir a nota.
-- Por isso reaproveita 'finance.nfse.manage' (sócios + Jessika) em vez de
-- criar uma capacidade nova que ninguém teria.
CREATE OR REPLACE FUNCTION public.bol_config_get(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT to_jsonb(c) INTO v_out FROM finance.boleto_config c WHERE c.tenant_id = v_tenant;
  RETURN COALESCE(v_out, jsonb_build_object('tenant_id', v_tenant, 'ativo', false));
END $function$;

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
    dias_limite_pagamento, instrucoes, recebimento_divergente, forma_envio
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
    COALESCE(NULLIF(p_config->>'forma_envio', ''), 'escritorio')
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
    updated_at = now()
  RETURNING to_jsonb(c) INTO v_out;

  RETURN v_out;
END $function$;

-- Prepara a emissão: valida, reserva o nosso número e devolve tudo o que a
-- edge function precisa para montar o payload.
--
-- A reserva acontece AQUI, numa transação, e não na edge function: dois
-- cliques simultâneos no mesmo lançamento têm de gerar um erro, não dois
-- boletos. O índice parcial idx_boletos_lancamento_vivo é quem garante isso
-- de verdade — a checagem abaixo só existe para dar uma mensagem legível.
CREATE OR REPLACE FUNCTION public.bol_preparar(p_user_id uuid, p_lancamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core', 'crm'
AS $function$
DECLARE
  v_tenant uuid;
  v_cfg finance.boleto_config%ROWTYPE;
  v_lanc finance.lancamentos%ROWTYPE;
  v_cli crm.clientes%ROWTYPE;
  v_seq bigint;
  v_nosso text;
  v_boleto_id uuid;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage') THEN
    RAISE EXCEPTION 'Sem permissão para emitir boleto'; END IF;

  SELECT * INTO v_cfg FROM finance.boleto_config WHERE tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_cfg.ativo THEN
    RAISE EXCEPTION 'Cobrança por boleto não está configurada.'; END IF;
  IF COALESCE(v_cfg.id_beneficiario, '') = '' THEN
    RAISE EXCEPTION 'Falta o id_beneficiario fornecido pelo Itaú.'; END IF;

  SELECT * INTO v_lanc FROM finance.lancamentos
   WHERE id = p_lancamento_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  IF v_lanc.natureza <> 'receber' THEN
    RAISE EXCEPTION 'Só lançamento a receber vira boleto.'; END IF;
  IF v_lanc.status IN ('cancelado', 'recebido') THEN
    RAISE EXCEPTION 'Lançamento % não pode gerar boleto.', v_lanc.status; END IF;
  IF v_lanc.valor IS NULL OR v_lanc.valor <= 0 THEN
    RAISE EXCEPTION 'Lançamento sem valor.'; END IF;

  IF EXISTS (SELECT 1 FROM finance.boletos b
              WHERE b.lancamento_id = p_lancamento_id
                AND b.status IN ('preparado', 'registrado', 'liquidado')) THEN
    RAISE EXCEPTION 'Este lançamento já tem boleto.'; END IF;

  SELECT * INTO v_cli FROM crm.clientes
   WHERE id = v_lanc.cliente_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento sem cliente.'; END IF;

  -- Contador por tenant, reaproveitando o mesmo mecanismo dos números de
  -- fatura (finance.next_tenant_counter).
  v_seq := finance.next_tenant_counter(v_tenant, 'boleto_nosso_numero');
  IF v_seq < v_cfg.nosso_numero_inicio THEN
    -- Primeira emissão: pula o contador para o início da faixa do banco.
    UPDATE finance.tenant_counters
       SET value = v_cfg.nosso_numero_inicio, updated_at = now()
     WHERE tenant_id = v_tenant AND key = 'boleto_nosso_numero';
    v_seq := v_cfg.nosso_numero_inicio;
  END IF;
  IF v_seq > v_cfg.nosso_numero_fim THEN
    RAISE EXCEPTION 'Faixa de nosso número esgotada (% a %). Peça uma faixa nova ao Itaú.',
      v_cfg.nosso_numero_inicio, v_cfg.nosso_numero_fim; END IF;

  v_nosso := lpad(v_seq::text, 8, '0');

  INSERT INTO finance.boletos (
    tenant_id, lancamento_id, nosso_numero, seu_numero, valor, vencimento,
    status, created_by
  ) VALUES (
    v_tenant, p_lancamento_id, v_nosso, left(replace(p_lancamento_id::text, '-', ''), 10),
    v_lanc.valor, v_lanc.vencimento, 'preparado', p_user_id
  ) RETURNING id INTO v_boleto_id;

  RETURN jsonb_build_object(
    'boleto_id', v_boleto_id,
    'config', to_jsonb(v_cfg),
    'titulo', jsonb_build_object(
      'nosso_numero', v_nosso,
      'seu_numero', left(replace(p_lancamento_id::text, '-', ''), 10),
      'uso_beneficiario', left(COALESCE(v_lanc.descricao, 'VLMA'), 25),
      'valor', v_lanc.valor,
      'vencimento', v_lanc.vencimento,
      'data_emissao', CURRENT_DATE
    ),
    'pagador', jsonb_build_object(
      'nome', v_cli.nome,
      'tipo', CASE WHEN length(regexp_replace(COALESCE(v_cli.cnpj, ''), '\D', '', 'g')) = 11
                   THEN 'F' ELSE 'J' END,
      'documento', regexp_replace(COALESCE(v_cli.cnpj, ''), '\D', '', 'g'),
      'logradouro', trim(COALESCE(v_cli.rua, '') || ', ' || COALESCE(v_cli.numero, '')),
      'bairro', COALESCE(v_cli.bairro, ''),
      'cidade', COALESCE(v_cli.cidade, ''),
      'uf', COALESCE(v_cli.estado, ''),
      'cep', regexp_replace(COALESCE(v_cli.cep, ''), '\D', '', 'g')
    )
  );
END $function$;

-- Grava o desfecho da chamada ao banco. Chamada pela edge function logo depois
-- do POST, tanto no sucesso quanto no erro — um boleto 'preparado' que fica
-- parado significa que a edge function morreu no meio, e isso tem de aparecer.
CREATE OR REPLACE FUNCTION public.bol_registrar(
  p_user_id uuid,
  p_boleto_id uuid,
  p_payload jsonb,
  p_resposta jsonb,
  p_erro text DEFAULT NULL
)
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

  UPDATE finance.boletos b SET
    status = CASE WHEN p_erro IS NOT NULL THEN 'erro' ELSE 'registrado' END,
    payload_enviado = COALESCE(p_payload, b.payload_enviado),
    resposta = COALESCE(p_resposta, b.resposta),
    erro_mensagem = p_erro,
    id_boleto = COALESCE(p_resposta->>'id_boleto', b.id_boleto),
    codigo_barras = COALESCE(p_resposta->>'codigo_barras', b.codigo_barras),
    linha_digitavel = COALESCE(p_resposta->>'linha_digitavel', b.linha_digitavel),
    pix_copia_cola = COALESCE(p_resposta->>'pix_copia_cola', b.pix_copia_cola),
    updated_at = now()
  WHERE b.id = p_boleto_id AND b.tenant_id = v_tenant
  RETURNING to_jsonb(b) INTO v_out;

  IF v_out IS NULL THEN RAISE EXCEPTION 'Boleto não encontrado'; END IF;
  RETURN v_out;
END $function$;

-- Aplica uma notificação do webhook do Itaú.
--
-- Sem p_user_id de propósito: quem chama é a edge function do webhook, com a
-- service role, porque do outro lado está o banco e não uma pessoa logada. Por
-- isso ela NÃO é exposta ao papel authenticated (o REVOKE no fim do arquivo) —
-- caso contrário qualquer usuário logado poderia dar baixa em qualquer título
-- dizendo que o banco avisou.
--
-- Idempotente: o Itaú reenvia notificação quando não recebe 200, e a mesma
-- baixa chegando duas vezes não pode virar dois recebimentos.
CREATE OR REPLACE FUNCTION public.bol_aplicar_notificacao(p_notificacao jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_bol finance.boletos%ROWTYPE;
  v_valor numeric(14,2);
  v_data date;
BEGIN
  SELECT * INTO v_bol FROM finance.boletos
   WHERE (p_notificacao->>'id_boleto' IS NOT NULL AND id_boleto = p_notificacao->>'id_boleto')
      OR (p_notificacao->>'nosso_numero' IS NOT NULL AND nosso_numero = p_notificacao->>'nosso_numero')
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'boleto desconhecido');
  END IF;

  IF v_bol.status = 'liquidado' THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'ja liquidado', 'boleto_id', v_bol.id);
  END IF;

  v_valor := COALESCE((p_notificacao->>'valor_pago')::numeric, v_bol.valor);
  v_data := COALESCE((p_notificacao->>'data_credito')::date,
                     (p_notificacao->>'data_notificacao')::date,
                     CURRENT_DATE);

  UPDATE finance.boletos SET
    status = 'liquidado',
    valor_pago = v_valor,
    data_credito = v_data,
    notificacao = p_notificacao,
    updated_at = now()
  WHERE id = v_bol.id;

  -- A baixa do lançamento usa o valor que o banco creditou, não o valor do
  -- título: pagamento parcial ou com juros entra no caixa pelo que entrou
  -- mesmo. O fluxo de caixa lê baixa_valor.
  UPDATE finance.lancamentos SET
    status = 'recebido',
    baixa_data = v_data,
    baixa_valor = v_valor,
    updated_at = now()
  WHERE id = v_bol.lancamento_id
    AND tenant_id = v_bol.tenant_id
    AND status <> 'cancelado';

  RETURN jsonb_build_object('aplicado', true, 'boleto_id', v_bol.id,
                            'lancamento_id', v_bol.lancamento_id, 'valor', v_valor);
END $function$;

-- Lista os boletos de um mês, para a tela de contas a receber.
CREATE OR REPLACE FUNCTION public.bol_listar(p_user_id uuid, p_mes date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_ini date;
  v_fim date;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  v_ini := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_fim := (v_ini + interval '1 month - 1 day')::date;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento, x.nosso_numero)
    FROM (
      SELECT b.id, b.lancamento_id, b.nosso_numero, b.seu_numero, b.valor,
             b.vencimento, b.status, b.linha_digitavel, b.pix_copia_cola,
             b.valor_pago, b.data_credito, b.erro_mensagem, l.descricao
      FROM finance.boletos b
      JOIN finance.lancamentos l ON l.id = b.lancamento_id
      WHERE b.tenant_id = v_tenant
        AND b.vencimento BETWEEN v_ini AND v_fim
    ) x
  ), '[]'::jsonb);
END $function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. PERMISSÕES DE EXECUÇÃO
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.bol_aplicar_notificacao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bol_aplicar_notificacao(jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.bol_config_get(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bol_config_upsert(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bol_preparar(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bol_registrar(uuid, uuid, jsonb, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bol_listar(uuid, date) TO authenticated, service_role;
