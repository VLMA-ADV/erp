-- Plano de contas: (1) RPCs de CRUD p/ a aba em Configurações; (2) correção de
-- acentuação dos nomes (pedido do cliente). Segurança: RPCs SECURITY DEFINER que
-- resolvem tenant/identidade por auth.uid() (não confiam em parâmetro) e gateiam
-- escrita por finance.contas_pagar.write / config.* / * (sócio tem tudo pelo blanket).
-- Chamadas direto pelo front (authenticated), no padrão do cp_listas.
--
-- A correção de acentuação é UPDATE por valor de texto: como os lançamentos
-- referenciam finance.plano_contas por id (plano_conta_id), mudar o texto é
-- display-only — não quebra integridade.

-- ============ 1) CRUD ============

-- Lista o plano de contas do tenant do usuário (ordenado por código).
CREATE OR REPLACE FUNCTION public.plano_contas_listar()
 RETURNS TABLE(id uuid, codigo text, grupo text, sintetica text, analitica text, natureza text, ativo boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tu.tenant_id INTO v_tenant FROM core.tenant_users tu
   WHERE tu.user_id = v_uid AND tu.status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.get_user_permissions(v_uid) p
                 WHERE p.permission_key IN ('finance.contas_pagar.read','finance.contas_pagar.write','config.*','*')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o plano de contas';
  END IF;

  RETURN QUERY
  SELECT pc.id, pc.codigo, pc.grupo, pc.sintetica, pc.analitica, pc.natureza, pc.ativo
  FROM finance.plano_contas pc
  WHERE pc.tenant_id = v_tenant
  ORDER BY pc.codigo, pc.grupo, pc.sintetica, pc.analitica;
END;
$function$;

-- Cria (p_id nulo) ou atualiza uma conta analítica.
CREATE OR REPLACE FUNCTION public.plano_contas_upsert(
  p_id uuid, p_codigo text, p_grupo text, p_sintetica text, p_analitica text,
  p_natureza text, p_ativo boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_id uuid;
  v_row finance.plano_contas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tu.tenant_id INTO v_tenant FROM core.tenant_users tu
   WHERE tu.user_id = v_uid AND tu.status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.get_user_permissions(v_uid) p
                 WHERE p.permission_key IN ('finance.contas_pagar.write','config.*','*')) THEN
    RAISE EXCEPTION 'Sem permissão para editar o plano de contas';
  END IF;

  -- validações
  p_codigo := btrim(coalesce(p_codigo,''));
  p_grupo := btrim(coalesce(p_grupo,''));
  p_sintetica := btrim(coalesce(p_sintetica,''));
  p_analitica := btrim(coalesce(p_analitica,''));
  p_natureza := btrim(coalesce(p_natureza,''));
  IF p_codigo='' OR p_grupo='' OR p_sintetica='' OR p_analitica='' THEN
    RAISE EXCEPTION 'Código, grupo, conta sintética e analítica são obrigatórios';
  END IF;
  IF p_natureza NOT IN ('Devedora','Credora') THEN
    RAISE EXCEPTION 'Natureza deve ser Devedora ou Credora';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO finance.plano_contas (id, tenant_id, codigo, grupo, sintetica, analitica, natureza, ativo)
    VALUES (gen_random_uuid(), v_tenant, p_codigo, p_grupo, p_sintetica, p_analitica, p_natureza, coalesce(p_ativo,true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE finance.plano_contas
       SET codigo=p_codigo, grupo=p_grupo, sintetica=p_sintetica,
           analitica=p_analitica, natureza=p_natureza, ativo=coalesce(p_ativo,true)
     WHERE id=p_id AND tenant_id=v_tenant
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Conta não encontrada neste tenant'; END IF;
  END IF;

  SELECT * INTO v_row FROM finance.plano_contas WHERE id=v_id;
  RETURN to_jsonb(v_row);
END;
$function$;

-- Exclui uma conta; se estiver referenciada por lançamento, apenas inativa.
CREATE OR REPLACE FUNCTION public.plano_contas_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tu.tenant_id INTO v_tenant FROM core.tenant_users tu
   WHERE tu.user_id = v_uid AND tu.status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.get_user_permissions(v_uid) p
                 WHERE p.permission_key IN ('finance.contas_pagar.write','config.*','*')) THEN
    RAISE EXCEPTION 'Sem permissão para excluir do plano de contas';
  END IF;

  BEGIN
    DELETE FROM finance.plano_contas WHERE id=p_id AND tenant_id=v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada neste tenant'; END IF;
    RETURN jsonb_build_object('excluido', true, 'inativado', false);
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE finance.plano_contas SET ativo=false WHERE id=p_id AND tenant_id=v_tenant;
    RETURN jsonb_build_object('excluido', false, 'inativado', true,
      'aviso', 'Conta em uso por lançamentos; foi inativada em vez de excluída.');
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.plano_contas_listar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plano_contas_upsert(uuid,text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plano_contas_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plano_contas_listar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_upsert(uuid,text,text,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_excluir(uuid) TO authenticated, service_role;

-- ============ 2) Correção de acentuação (display-only; ref por id) ============
DO $$
DECLARE
  m text[][] := ARRAY[
    -- grupo / sintética
    ['OPEX - Confraternizacoes, Presentes e Doacoes','OPEX - Confraternizações, Presentes e Doações'],
    ['OPEX - Infraestrutura / Ocupacao','OPEX - Infraestrutura / Ocupação'],
    ['Confraternizacoes, Presentes e Doacoes','Confraternizações, Presentes e Doações'],
    ['Despesas com Infraestrutura / Ocupacao','Despesas com Infraestrutura / Ocupação'],
    -- analítica
    ['13o salario','13º salário'],
    ['14o salario / bonus','14º salário / bônus'],
    ['Alimentacao operacional / reunioes','Alimentação operacional / reuniões'],
    ['Beneficios (saude, VR, VT, prev.)','Benefícios (saúde, VR, VT, prev.)'],
    ['Cartorio e taxas notariais','Cartório e taxas notariais'],
    ['Condominio','Condomínio'],
    ['Confraternizacoes e happy hours','Confraternizações e happy hours'],
    ['Contribuicao sindical e patronal','Contribuição sindical e patronal'],
    ['Devolucoes e ajustes','Devoluções e ajustes'],
    ['Doacoes e patrocinios','Doações e patrocínios'],
    ['Energia eletrica','Energia elétrica'],
    ['Estagiarios','Estagiários'],
    ['Ferias','Férias'],
    ['Honorarios (juridico/contabil/consultoria)','Honorários (jurídico/contábil/consultoria)'],
    ['Indicacao de negocios (premiacao interna)','Indicação de negócios (premiação interna)'],
    ['Indicacao de parceiros de negocios','Indicação de parceiros de negócios'],
    ['Juros e encargos de cartao de credito','Juros e encargos de cartão de crédito'],
    ['Juros e encargos de emprestimos','Juros e encargos de empréstimos'],
    ['Limpeza e conservacao','Limpeza e conservação'],
    ['Manutencao e reparos','Manutenção e reparos'],
    ['Material de escritorio','Material de escritório'],
    ['PLR - Participacao nos resultados','PLR - Participação nos resultados'],
    ['Pro-labore / Remuneracao de socios','Pró-labore / Remuneração de sócios'],
    ['Prospeccao - alimentacao','Prospecção - alimentação'],
    ['Prospeccao - deslocamento e viagens','Prospecção - deslocamento e viagens'],
    ['Prospeccao - eventos e passagens','Prospecção - eventos e passagens'],
    ['Prospeccao - hospedagem','Prospecção - hospedagem'],
    ['Remuneracao de associados (DL)','Remuneração de associados (DL)'],
    ['Rescisoes e acordos trabalhistas','Rescisões e acordos trabalhistas'],
    ['Revistas, jornais e publicacoes','Revistas, jornais e publicações'],
    ['Salarios e ordenados','Salários e ordenados'],
    ['Saude e seguranca ocupacional','Saúde e segurança ocupacional'],
    ['Servicos de PJ / terceiros','Serviços de PJ / terceiros'],
    ['Servicos e suporte de TI','Serviços e suporte de TI'],
    ['Servicos graficos','Serviços gráficos'],
    ['Tarifas bancarias','Tarifas bancárias'],
    ['Taxas e contribuicoes diversas','Taxas e contribuições diversas'],
    ['Telefonia movel','Telefonia móvel'],
    ['Tributos sobre faturamento proprio (PIS/COFINS/CSLL/IRRF)','Tributos sobre faturamento próprio (PIS/COFINS/CSLL/IRRF)']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(m,1) LOOP
    UPDATE finance.plano_contas SET grupo     = m[i][2] WHERE grupo     = m[i][1];
    UPDATE finance.plano_contas SET sintetica = m[i][2] WHERE sintetica = m[i][1];
    UPDATE finance.plano_contas SET analitica = m[i][2] WHERE analitica = m[i][1];
  END LOOP;
END $$;
