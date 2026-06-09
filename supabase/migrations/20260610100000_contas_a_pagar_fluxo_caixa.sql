-- =====================================================================
-- MÓDULO CONTAS A PAGAR / FLUXO DE CAIXA — VLMA ERP
-- PRD: docs/prd-contas-a-pagar.md (spec fechada 2026-06-10)
--
-- Decisões da spec refletidas aqui:
--  - Plano de contas em 2 CAMADAS: conta contábil (código) + centro de custo
--    (= categoria/grupo macro do PRD; rótulo de UI "Centro de custo").
--  - Despesa por EMPRESA pagadora (Escritório/Ravena/Verve) + flag REEMBOLSÁVEL.
--  - Recorrência: nº de parcelas (0 = sem prazo) gerando 1 lançamento/mês.
--  - Reajuste programado: data + % IPCA DIGITADO (estimativa, sem fonte automática).
--  - Baixa: status + reagendar; SEM conciliação bancária na fase 1.
--  - Fluxo de caixa: SALDO INICIAL MANUAL por conta bancária (Itaú).
--  - Lançamento único pagar/receber (tabela finance.lancamentos, natureza).
--
-- Convenções seguidas (ver migrations existentes): schema de domínio,
-- tenant_id NOT NULL, uuid gen_random_uuid, numeric(14,2), índices por tenant.
-- Aplicar manual via Supabase Management API (canal vigente do projeto).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. LISTAS DE APOIO (plano de contas em 2 camadas, empresas, bancos)
-- ─────────────────────────────────────────────────────────────────────

-- Centro de custo = categoria / grupo macro (Despesa Administrativa, Imóvel,
-- Impostos Diretos/Indiretos…). É a 2ª camada do plano de contas.
CREATE TABLE IF NOT EXISTS finance.centros_custo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  nome        text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_centros_custo_tenant ON finance.centros_custo (tenant_id, ativo);

-- Conta contábil = código numérico (1ª camada). Vincula a um centro de custo.
CREATE TABLE IF NOT EXISTS finance.contas_contabeis (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  codigo           text NOT NULL,                 -- ex.: 4.1.01.001
  nome             text NOT NULL,                 -- ex.: Aluguel
  centro_custo_id  uuid REFERENCES finance.centros_custo (id) ON DELETE SET NULL,
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_contas_contabeis_tenant ON finance.contas_contabeis (tenant_id, ativo);

-- Empresas do grupo (fonte pagadora): Escritório/VLMA, Ravena, Verve.
CREATE TABLE IF NOT EXISTS finance.empresas_grupo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  nome        text NOT NULL,
  cnpj        text,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_empresas_grupo_tenant ON finance.empresas_grupo (tenant_id, ativo);

-- Contas bancárias com SALDO INICIAL MANUAL (sem conciliação na fase 1).
CREATE TABLE IF NOT EXISTS finance.contas_bancarias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  banco               text NOT NULL,              -- ex.: Itaú
  descricao           text,                       -- ex.: Itaú Ag. 3835 C/C 31141-0
  saldo_abertura      numeric(14,2) NOT NULL DEFAULT 0,
  saldo_abertura_data date NOT NULL DEFAULT CURRENT_DATE,
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contas_bancarias_tenant ON finance.contas_bancarias (tenant_id, ativo);

-- ─────────────────────────────────────────────────────────────────────
-- 2. RECORRÊNCIA (gera 1 lançamento por mês; N=0 => sem prazo)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.recorrencias (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  valor_base                  numeric(14,2) NOT NULL,
  dia_vencimento              smallint,                 -- dia do mês (1-31)
  inicio                      date NOT NULL,
  num_parcelas                integer NOT NULL DEFAULT 0, -- 0 = sem prazo (até cancelar)
  -- Reajuste programado (estimativa "de padaria"): % digitado, sem fonte automática.
  reajuste_data               date,
  reajuste_indice             text DEFAULT 'IPCA',
  reajuste_percentual_estim   numeric(7,4),             -- ex.: 4.5000 (%)
  ativo                       boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recorrencias_tenant ON finance.recorrencias (tenant_id, ativo);

-- ─────────────────────────────────────────────────────────────────────
-- 3. LANÇAMENTOS (pagar E receber numa tabela só — espelha o "Novo lançamento")
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE finance.lancamento_natureza AS ENUM ('pagar', 'receber');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finance.lancamento_status AS ENUM
    ('pendente', 'agendado', 'pago', 'recebido', 'atrasado', 'cancelado', 'remanejado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finance.lancamento_origem AS ENUM ('manual', 'recorrencia', 'reembolso', 'faturamento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS finance.lancamentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  natureza           finance.lancamento_natureza NOT NULL,
  tipo               text,                         -- 'fixo' | 'variavel' (despesas)
  status             finance.lancamento_status NOT NULL DEFAULT 'pendente',

  -- Partes
  empresa_id         uuid REFERENCES finance.empresas_grupo (id) ON DELETE SET NULL,   -- fonte pagadora
  fornecedor_nome    text,                          -- fornecedor (pagar) — texto livre por ora
  cliente_id         uuid,                          -- crm.clientes (receber) — sem FK p/ não acoplar schema
  descricao          text NOT NULL,

  -- Classificação (2 camadas)
  conta_contabil_id  uuid REFERENCES finance.contas_contabeis (id) ON DELETE SET NULL,
  centro_custo_id    uuid REFERENCES finance.centros_custo (id) ON DELETE SET NULL,

  -- Valores e datas
  valor              numeric(14,2) NOT NULL,
  vencimento         date NOT NULL,

  -- Recorrência / reajuste
  recorrencia_id     uuid REFERENCES finance.recorrencias (id) ON DELETE SET NULL,
  parcela_numero     integer,                       -- n da parcela quando recorrente

  -- Reembolso (flag + previsão de entrada gerada)
  reembolsavel       boolean NOT NULL DEFAULT false,
  reembolso_de_id    uuid REFERENCES finance.lancamentos (id) ON DELETE SET NULL, -- entrada aponta p/ a despesa

  -- Documento / pagamento
  numero_nota        text,
  forma_pagamento    text,
  conta_bancaria_id  uuid REFERENCES finance.contas_bancarias (id) ON DELETE SET NULL,
  anexo_url          text,
  observacoes        text,

  -- Baixa
  baixa_data         date,
  baixa_valor        numeric(14,2),
  baixa_conta_id     uuid REFERENCES finance.contas_bancarias (id) ON DELETE SET NULL,

  -- Reagendamento (histórico do vencimento anterior)
  reagendado_de      date,

  -- Origem / rastreio
  origem             finance.lancamento_origem NOT NULL DEFAULT 'manual',
  origem_ref_id      uuid,                          -- ex.: billing_note/contrato quando origem=faturamento

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid
);
CREATE INDEX IF NOT EXISTS idx_lancamentos_tenant_venc   ON finance.lancamentos (tenant_id, vencimento);
CREATE INDEX IF NOT EXISTS idx_lancamentos_tenant_nat    ON finance.lancamentos (tenant_id, natureza, status);
CREATE INDEX IF NOT EXISTS idx_lancamentos_recorrencia   ON finance.lancamentos (recorrencia_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_reembolso     ON finance.lancamentos (reembolso_de_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. PERMISSÕES (seguindo formato domain.feature.action)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT t.id, v.chave, v.descricao, 'finance'
FROM core.tenants t
CROSS JOIN (VALUES
  ('finance.contas_pagar.read',  'Visualizar contas a pagar/receber e fluxo de caixa'),
  ('finance.contas_pagar.write', 'Criar, editar e dar baixa em lançamentos financeiros')
) AS v(chave, descricao)
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p
  WHERE p.tenant_id = t.id AND p.chave = v.chave
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. SEED MÍNIMO para o tenant VLMA (listas reais virão da planilha depois)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM core.tenants
   WHERE nome ILIKE '%vlma%' OR nome ILIKE '%voa%legal%' OR nome ILIKE '%lascio%' LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Tenant VLMA não encontrado — pulando seed.';
    RETURN;
  END IF;

  -- Empresas do grupo
  INSERT INTO finance.empresas_grupo (tenant_id, nome) VALUES
    (v_tenant, 'VLMA (Escritório)'), (v_tenant, 'Ravena'), (v_tenant, 'Verve')
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- Conta bancária principal (saldo inicial a ser ajustado manualmente na tela)
  INSERT INTO finance.contas_bancarias (tenant_id, banco, descricao, saldo_abertura, saldo_abertura_data)
  SELECT v_tenant, 'Itaú', 'Itaú Ag. 3835 - C/C 31141-0', 0, CURRENT_DATE
  WHERE NOT EXISTS (SELECT 1 FROM finance.contas_bancarias WHERE tenant_id = v_tenant);

  -- Centros de custo (categoria/grupo macro) — exemplos guiados pelo mock/planilha
  INSERT INTO finance.centros_custo (tenant_id, nome) VALUES
    (v_tenant, 'Despesas Administrativas'),
    (v_tenant, 'Imóvel'),
    (v_tenant, 'Pessoal / Folha'),
    (v_tenant, 'Impostos Diretos'),
    (v_tenant, 'Impostos Indiretos'),
    (v_tenant, 'Contencioso'),
    (v_tenant, 'Contratos / Software')
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- Algumas contas contábeis de exemplo (códigos do mock) p/ as telas terem dado
  INSERT INTO finance.contas_contabeis (tenant_id, codigo, nome, centro_custo_id)
  SELECT v_tenant, x.codigo, x.nome, cc.id
  FROM (VALUES
    ('4.1.01.001', 'Aluguel',              'Imóvel'),
    ('4.1.02.003', 'Energia Elétrica',     'Despesas Administrativas'),
    ('4.1.03.010', 'Software Jurídico',    'Contratos / Software'),
    ('4.1.04.001', 'Material de Escritório','Despesas Administrativas'),
    ('4.1.05.001', 'Plano de Saúde',       'Pessoal / Folha'),
    ('4.2.01.005', 'Honorários Correspondente','Contencioso'),
    ('4.3.01.002', 'DARF IRPJ',            'Impostos Diretos')
  ) AS x(codigo, nome, centro)
  LEFT JOIN finance.centros_custo cc ON cc.tenant_id = v_tenant AND cc.nome = x.centro
  WHERE NOT EXISTS (
    SELECT 1 FROM finance.contas_contabeis c WHERE c.tenant_id = v_tenant AND c.codigo = x.codigo
  );
END $$;

NOTIFY pgrst, 'reload schema';
