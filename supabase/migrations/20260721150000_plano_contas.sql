-- Contas a pagar/receber: Plano de Contas (planilha VLMA 21/07) —
-- hierarquia Grupo (DRE) > Conta sintética > Conta analítica (recebe o lançamento).
CREATE TABLE IF NOT EXISTS finance.plano_contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  codigo text NOT NULL,
  grupo text NOT NULL,
  sintetica text NOT NULL,
  analitica text NOT NULL,
  natureza text NOT NULL DEFAULT 'Devedora',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

ALTER TABLE finance.lancamentos ADD COLUMN IF NOT EXISTS plano_conta_id uuid REFERENCES finance.plano_contas(id);

-- Seed (59 contas analíticas da planilha) — idempotente por (tenant, codigo).
INSERT INTO finance.plano_contas (tenant_id, codigo, grupo, sintetica, analitica, natureza)
SELECT 'd51463dd-a6b3-40e7-9488-854eba80a210'::uuid, v.codigo, v.grupo, v.sintetica, v.analitica, v.natureza
FROM (VALUES
    ('5.1.01', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Salarios e ordenados', 'Devedora'),
    ('5.1.02', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Pro-labore / Remuneracao de socios', 'Devedora'),
    ('5.1.03', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Remuneracao de associados (DL)', 'Devedora'),
    ('5.1.04', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Estagiarios', 'Devedora'),
    ('5.1.05', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', '13o salario', 'Devedora'),
    ('5.1.06', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', '14o salario / bonus', 'Devedora'),
    ('5.1.07', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'PLR - Participacao nos resultados', 'Devedora'),
    ('5.1.08', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Ferias', 'Devedora'),
    ('5.1.09', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Rescisoes e acordos trabalhistas', 'Devedora'),
    ('5.1.10', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Encargos sociais (INSS/FGTS/GPS)', 'Devedora'),
    ('5.1.11', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Contribuicao sindical e patronal', 'Devedora'),
    ('5.1.12', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Beneficios (saude, VR, VT, prev.)', 'Devedora'),
    ('5.1.13', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Treinamento e desenvolvimento', 'Devedora'),
    ('5.1.14', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Saude e seguranca ocupacional', 'Devedora'),
    ('5.1.15', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Uniformes e EPIs', 'Devedora'),
    ('5.1.16', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'OAB e registros profissionais', 'Devedora'),
    ('5.1.17', 'OPEX - Despesas com Pessoal', 'Despesas com Pessoal', 'Indicacao de negocios (premiacao interna)', 'Devedora'),
    ('5.2.01', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Aluguel', 'Devedora'),
    ('5.2.02', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Condominio', 'Devedora'),
    ('5.2.03', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Energia eletrica', 'Devedora'),
    ('5.2.04', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'IPTU', 'Devedora'),
    ('5.2.05', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Seguros patrimoniais', 'Devedora'),
    ('5.2.06', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Manutencao e reparos', 'Devedora'),
    ('5.2.07', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Limpeza e conservacao', 'Devedora'),
    ('5.2.08', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Estacionamento', 'Devedora'),
    ('5.2.09', 'OPEX - Infraestrutura / Ocupacao', 'Despesas com Infraestrutura / Ocupacao', 'Materiais de consumo / copa', 'Devedora'),
    ('5.3.01', 'OPEX - Tecnologia', 'Despesas com Tecnologia', 'Licenciamento de software (SaaS)', 'Devedora'),
    ('5.3.02', 'OPEX - Tecnologia', 'Despesas com Tecnologia', 'Equipamentos de TI (pequeno valor)', 'Devedora'),
    ('5.3.03', 'OPEX - Tecnologia', 'Despesas com Tecnologia', 'Internet e links de dados', 'Devedora'),
    ('5.3.04', 'OPEX - Tecnologia', 'Despesas com Tecnologia', 'Telefonia fixa', 'Devedora'),
    ('5.3.05', 'OPEX - Tecnologia', 'Despesas com Tecnologia', 'Telefonia movel', 'Devedora'),
    ('5.3.06', 'OPEX - Tecnologia', 'Despesas com Tecnologia', 'Servicos e suporte de TI', 'Devedora'),
    ('5.4.01', 'OPEX - Comercial e Marketing', 'Despesas Comerciais e de Marketing', 'Marketing e publicidade', 'Devedora'),
    ('5.4.02', 'OPEX - Comercial e Marketing', 'Despesas Comerciais e de Marketing', 'Prospeccao - alimentacao', 'Devedora'),
    ('5.4.03', 'OPEX - Comercial e Marketing', 'Despesas Comerciais e de Marketing', 'Prospeccao - deslocamento e viagens', 'Devedora'),
    ('5.4.04', 'OPEX - Comercial e Marketing', 'Despesas Comerciais e de Marketing', 'Prospeccao - hospedagem', 'Devedora'),
    ('5.4.05', 'OPEX - Comercial e Marketing', 'Despesas Comerciais e de Marketing', 'Prospeccao - eventos e passagens', 'Devedora'),
    ('5.4.06', 'OPEX - Comercial e Marketing', 'Despesas Comerciais e de Marketing', 'Indicacao de parceiros de negocios', 'Devedora'),
    ('5.5.01', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Honorarios (juridico/contabil/consultoria)', 'Devedora'),
    ('5.5.02', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Servicos de PJ / terceiros', 'Devedora'),
    ('5.5.03', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Cartorio e taxas notariais', 'Devedora'),
    ('5.5.04', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Correios, motoboy e fretes', 'Devedora'),
    ('5.5.05', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Material de escritorio', 'Devedora'),
    ('5.5.06', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Servicos graficos', 'Devedora'),
    ('5.5.07', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Revistas, jornais e publicacoes', 'Devedora'),
    ('5.5.08', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Alimentacao operacional / reunioes', 'Devedora'),
    ('5.5.09', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Devolucoes e ajustes', 'Devedora'),
    ('5.5.10', 'OPEX - Administrativas e Gerais', 'Despesas Administrativas e Gerais', 'Bens de pequeno valor', 'Devedora'),
    ('5.6.01', 'OPEX - Tributos e Taxas Operacionais', 'Tributos e Taxas Operacionais', 'ISS fixo', 'Devedora'),
    ('5.6.02', 'OPEX - Tributos e Taxas Operacionais', 'Tributos e Taxas Operacionais', 'Taxas e contribuicoes diversas', 'Devedora'),
    ('5.7.01', 'OPEX - Confraternizacoes, Presentes e Doacoes', 'Confraternizacoes, Presentes e Doacoes', 'Confraternizacoes e happy hours', 'Devedora'),
    ('5.7.02', 'OPEX - Confraternizacoes, Presentes e Doacoes', 'Confraternizacoes, Presentes e Doacoes', 'Presentes (clientes/colaboradores)', 'Devedora'),
    ('5.7.03', 'OPEX - Confraternizacoes, Presentes e Doacoes', 'Confraternizacoes, Presentes e Doacoes', 'Doacoes e patrocinios', 'Devedora'),
    ('6.1.01', 'Resultado Financeiro', 'Resultado Financeiro', 'Tarifas bancarias', 'Devedora'),
    ('6.1.02', 'Resultado Financeiro', 'Resultado Financeiro', 'Juros e encargos de cartao de credito', 'Devedora'),
    ('6.1.03', 'Resultado Financeiro', 'Resultado Financeiro', 'Juros e encargos de emprestimos', 'Devedora'),
    ('6.1.04', 'Resultado Financeiro', 'Resultado Financeiro', 'Despesas com investimentos (corretagem)', 'Devedora'),
    ('7.1.01', 'Tributos sobre Faturamento e Lucro', 'Tributos sobre Faturamento e Lucro', 'Impostos retidos s/ notas de terceiros (IRRF/CSRF/GPS)', 'Devedora'),
    ('7.1.02', 'Tributos sobre Faturamento e Lucro', 'Tributos sobre Faturamento e Lucro', 'Tributos sobre faturamento proprio (PIS/COFINS/CSLL/IRRF)', 'Devedora')
) AS v(codigo, grupo, sintetica, analitica, natureza)
ON CONFLICT (tenant_id, codigo) DO UPDATE
  SET grupo = EXCLUDED.grupo, sintetica = EXCLUDED.sintetica, analitica = EXCLUDED.analitica, natureza = EXCLUDED.natureza, ativo = true;

CREATE OR REPLACE FUNCTION public.cp_listas(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE v_tenant uuid; v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão para o módulo financeiro';
  END IF;

  SELECT jsonb_build_object(
    'centros_custo', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
       FROM finance.centros_custo WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'contas_contabeis', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome, 'centro_custo_id', centro_custo_id) ORDER BY codigo)
       FROM finance.contas_contabeis WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'empresas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
       FROM finance.empresas_grupo WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'plano_contas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'grupo', grupo, 'sintetica', sintetica, 'analitica', analitica, 'natureza', natureza) ORDER BY codigo)
       FROM finance.plano_contas WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'contas_bancarias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'banco', banco, 'descricao', descricao, 'saldo_abertura', saldo_abertura, 'saldo_abertura_data', saldo_abertura_data) ORDER BY banco)
       FROM finance.contas_bancarias WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.cp_criar_lancamento(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid; v_id uuid; v_rec_id uuid; v_reembolso_id uuid;
  v_natureza finance.lancamento_natureza;
  v_valor numeric(14,2); v_venc date; v_recorrente boolean; v_reembolsavel boolean;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão para lançar';
  END IF;

  -- Validações mínimas (obrigatórios da spec)
  v_natureza := COALESCE((p_payload->>'natureza')::finance.lancamento_natureza, 'pagar');
  v_valor := NULLIF(p_payload->>'valor','')::numeric;
  v_venc  := NULLIF(p_payload->>'vencimento','')::date;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Valor é obrigatório'; END IF;
  IF v_venc IS NULL THEN RAISE EXCEPTION 'Vencimento é obrigatório'; END IF;
  IF COALESCE(p_payload->>'descricao','') = '' THEN RAISE EXCEPTION 'Descrição é obrigatória'; END IF;

  v_recorrente  := COALESCE((p_payload->>'recorrente')::boolean, false);
  v_reembolsavel := COALESCE((p_payload->>'reembolsavel')::boolean, false);

  -- Recorrência (cria o cabeçalho; parcelas geradas por cp_gerar_parcelas)
  IF v_recorrente THEN
    INSERT INTO finance.recorrencias (tenant_id, valor_base, dia_vencimento, inicio,
      num_parcelas, reajuste_data, reajuste_indice, reajuste_percentual_estim)
    VALUES (v_tenant, v_valor,
      COALESCE(NULLIF(p_payload->>'dia_vencimento','')::smallint, EXTRACT(DAY FROM v_venc)::smallint),
      v_venc,
      COALESCE(NULLIF(p_payload->>'num_parcelas','')::int, 0),
      NULLIF(p_payload->>'reajuste_data','')::date, 'IPCA',
      NULLIF(p_payload->>'reajuste_percentual_estim','')::numeric)
    RETURNING id INTO v_rec_id;
  END IF;

  -- Lançamento base
  INSERT INTO finance.lancamentos (
    tenant_id, natureza, tipo, status, empresa_id, fornecedor_nome, cliente_id,
    descricao, conta_contabil_id, plano_conta_id, centro_custo_id, valor, vencimento,
    recorrencia_id, parcela_numero, reembolsavel, numero_nota, forma_pagamento,
    conta_bancaria_id, anexo_url, observacoes, origem, created_by)
  VALUES (
    v_tenant, v_natureza, NULLIF(p_payload->>'tipo',''),
    COALESCE((p_payload->>'status')::finance.lancamento_status, 'pendente'),
    NULLIF(p_payload->>'empresa_id','')::uuid, NULLIF(p_payload->>'fornecedor_nome',''),
    NULLIF(p_payload->>'cliente_id','')::uuid, p_payload->>'descricao',
    NULLIF(p_payload->>'conta_contabil_id','')::uuid, NULLIF(p_payload->>'plano_conta_id','')::uuid, NULLIF(p_payload->>'centro_custo_id','')::uuid,
    v_valor, v_venc, v_rec_id, CASE WHEN v_recorrente THEN 1 ELSE NULL END,
    v_reembolsavel, NULLIF(p_payload->>'numero_nota',''), NULLIF(p_payload->>'forma_pagamento',''),
    NULLIF(p_payload->>'conta_bancaria_id','')::uuid, NULLIF(p_payload->>'anexo_url',''),
    NULLIF(p_payload->>'observacoes',''),
    CASE WHEN v_recorrente THEN 'recorrencia' ELSE 'manual' END::finance.lancamento_origem,
    p_user_id)
  RETURNING id INTO v_id;

  -- Reembolsável: gera a PREVISÃO DE ENTRADA vinculada (decisão da spec).
  IF v_reembolsavel AND v_natureza = 'pagar' THEN
    INSERT INTO finance.lancamentos (
      tenant_id, natureza, status, empresa_id, descricao, valor, vencimento,
      reembolso_de_id, origem, created_by)
    VALUES (
      v_tenant, 'receber', 'pendente', NULLIF(p_payload->>'empresa_id','')::uuid,
      'Reembolso: ' || (p_payload->>'descricao'), v_valor, v_venc,
      v_id, 'reembolso', p_user_id)
    RETURNING id INTO v_reembolso_id;
  END IF;

  -- Gera parcelas se recorrente
  IF v_recorrente THEN
    PERFORM public.cp_gerar_parcelas(p_user_id, v_rec_id, 12);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'recorrencia_id', v_rec_id, 'reembolso_id', v_reembolso_id);
END $function$
;
