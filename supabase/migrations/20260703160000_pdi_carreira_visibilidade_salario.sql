-- Bloco 1 (correções pós-leitura dos docs):
-- (1) carreira como CAMPO no cadastro do colaborador (5 carreiras; não deriva mais da área)
-- (2) visibilidade por área na lista da equipe (coordenador vê sua área; sócio/admin vê todos)
-- (3) salário sugerido do quadro de remuneração na progressão

-- ============ (1) coluna carreira + backfill ============
ALTER TABLE people.colaboradores ADD COLUMN IF NOT EXISTS carreira varchar;

-- Backfill de palpite (editável no cadastro): Contencioso pela área; adm/financeiro por categoria/área; senão Consultoria.
UPDATE people.colaboradores c SET carreira = CASE
  WHEN carreira IS NOT NULL AND carreira <> '' THEN carreira
  WHEN c.categoria = 'administrativo' THEN 'ADM_FIN'
  WHEN EXISTS (SELECT 1 FROM people.areas a WHERE a.id=c.area_id AND a.nome ILIKE 'Contencioso') THEN 'CONTENCIOSO'
  WHEN EXISTS (SELECT 1 FROM people.areas a WHERE a.id=c.area_id AND a.nome ILIKE 'Financeiro') THEN 'ADM_FIN'
  ELSE 'CONSULTORIA' END
WHERE carreira IS NULL OR carreira = '';

-- ============ get_minha_avaliacao_pdi: lê o campo carreira (fallback derive) ============
CREATE OR REPLACE FUNCTION public.get_minha_avaliacao_pdi(p_ano int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE
  v_tenant uuid; v_colab uuid; v_cargo_id uuid; v_cargo_nome varchar; v_nivel varchar;
  v_adicional varchar; v_area varchar; v_carreira varchar; v_carreira_field varchar; v_aval uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT c.id, c.cargo_id, ca.nome, ca.codigo, c.adicional::varchar, a.nome, c.carreira
    INTO v_colab, v_cargo_id, v_cargo_nome, v_nivel, v_adicional, v_area, v_carreira_field
  FROM people.colaboradores c
  LEFT JOIN people.cargos ca ON ca.id=c.cargo_id
  LEFT JOIN people.areas a ON a.id=c.area_id
  WHERE c.user_id = auth.uid() AND c.tenant_id=v_tenant LIMIT 1;
  IF v_colab IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado para este usuário'; END IF;

  v_nivel := CASE
    WHEN v_nivel ~* '^ESTAG' THEN 'ESTAGIARIO'
    WHEN v_nivel ~* '^JR[0-9]' OR v_nivel ~* '^JUNIOR' THEN 'JUNIOR'
    WHEN v_nivel ~* '^PL' THEN 'PLENO'
    WHEN v_nivel ~* '^SR' OR v_nivel ~* '^SENIOR' THEN 'SENIOR'
    ELSE 'SENIOR' END;
  -- carreira agora vem do CADASTRO; deriva só como fallback se ainda estiver vazia
  v_carreira := COALESCE(NULLIF(v_carreira_field,''),
                         CASE WHEN v_area ILIKE 'Contencioso' THEN 'CONTENCIOSO' ELSE 'CONSULTORIA' END);

  SELECT id INTO v_aval FROM people.avaliacoes_pdi WHERE tenant_id=v_tenant AND colaborador_id=v_colab AND ano=p_ano LIMIT 1;
  IF v_aval IS NULL THEN
    INSERT INTO people.avaliacoes_pdi (tenant_id, ano, tipo, colaborador_id, status,
      cargo_id_snapshot, cargo_nome_snapshot, nivel_codigo_snapshot, carreira_codigo, adicional_snapshot, area_nome_snapshot, created_by)
    VALUES (v_tenant, p_ano, 'definitiva', v_colab, 'rascunho',
      v_cargo_id, v_cargo_nome, v_nivel, v_carreira, v_adicional, v_area, auth.uid())
    RETURNING id INTO v_aval;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_skills_carreira WHERE avaliacao_pdi_id=v_aval) THEN
    INSERT INTO people.avaliacoes_pdi_skills_carreira
      (avaliacao_pdi_id, trilha, pilar_numero, pilar_nome, item_codigo, titulo, nome, descricao, ordem)
    SELECT v_aval, s.trilha, s.pilar_numero, p.nome, s.item_codigo, s.titulo,
           COALESCE(NULLIF(s.titulo,''),p.nome), s.descricao, s.ordem
    FROM people.pdi_skills_catalogo s
    JOIN people.pdi_pilares p ON p.tenant_id=s.tenant_id AND p.trilha=s.trilha AND p.numero=s.pilar_numero
    WHERE s.tenant_id=v_tenant
      AND ( (s.trilha='base' AND s.nivel_codigo=v_nivel)
            OR (v_adicional IS NOT NULL AND s.trilha=v_adicional AND s.nivel_codigo='TODOS') );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_dna_vlma WHERE avaliacao_pdi_id=v_aval) THEN
    INSERT INTO people.avaliacoes_pdi_dna_vlma (avaliacao_pdi_id, numero, nome, ordem)
    SELECT v_aval, d.numero, d.nome, d.numero FROM people.pdi_dna_itens d WHERE d.tenant_id=v_tenant;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM people.avaliacoes_pdi_feedbacks_mensais WHERE avaliacao_pdi_id=v_aval) THEN
    INSERT INTO people.avaliacoes_pdi_feedbacks_mensais (avaliacao_pdi_id, mes)
    SELECT v_aval, g FROM generate_series(1,12) g;
  END IF;

  RETURN jsonb_build_object(
    'avaliacao', (SELECT to_jsonb(x) FROM (
        SELECT a.id, a.ano, a.status, a.bloqueada, a.faixa_final_geral, a.autoavaliacao_enviada_at,
               a.cargo_nome_snapshot, a.nivel_codigo_snapshot, a.carreira_codigo, a.adicional_snapshot, a.area_nome_snapshot,
               (SELECT nome FROM people.colaboradores WHERE id=a.colaborador_id) AS colaborador_nome
        FROM people.avaliacoes_pdi a WHERE a.id=v_aval) x),
    'regua', (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id=v_tenant),
    'skills', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.trilha, s.pilar_numero, s.item_codigo),'[]'::jsonb) FROM people.avaliacoes_pdi_skills_carreira s WHERE s.avaliacao_pdi_id=v_aval),
    'dna', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.numero),'[]'::jsonb) FROM people.avaliacoes_pdi_dna_vlma d WHERE d.avaliacao_pdi_id=v_aval),
    'metas', (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.semestre, m.ordem, m.created_at),'[]'::jsonb) FROM people.avaliacoes_pdi_metas_individuais m WHERE m.avaliacao_pdi_id=v_aval),
    'feedbacks', (SELECT COALESCE(jsonb_agg(to_jsonb(fb) ORDER BY fb.mes),'[]'::jsonb) FROM people.avaliacoes_pdi_feedbacks_mensais fb WHERE fb.avaliacao_pdi_id=v_aval)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_minha_avaliacao_pdi(int) TO authenticated;

-- ============ (2) get_equipe_avaliacoes_pdi: visibilidade por área ============
CREATE OR REPLACE FUNCTION public.get_equipe_avaliacoes_pdi(p_ano int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid; v_cat people.colaborador_categoria; v_area uuid; v_ve_tudo boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;

  SELECT categoria, area_id INTO v_cat, v_area FROM people.colaboradores WHERE user_id=auth.uid() AND tenant_id=v_tenant LIMIT 1;
  -- sócio/administrativo veem todos; coordenador (demais com pdi.write) vê só a sua área
  v_ve_tudo := (v_cat IN ('socio','administrativo'));

  RETURN jsonb_build_object(
    'ano', p_ano,
    'escopo', CASE WHEN v_ve_tudo THEN 'todos' ELSE 'area' END,
    'itens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.colaborador_nome), '[]'::jsonb) FROM (
        SELECT a.id, a.status, a.faixa_final_geral, a.resultado::text AS resultado,
               a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at, a.progressao_aplicada_at,
               a.cargo_nome_snapshot, a.area_nome_snapshot, a.carreira_codigo, a.adicional_snapshot,
               col.nome AS colaborador_nome, col.categoria::text AS categoria
        FROM people.avaliacoes_pdi a
        JOIN people.colaboradores col ON col.id = a.colaborador_id
        WHERE a.tenant_id = v_tenant AND a.ano = p_ano
          AND (v_ve_tudo OR col.area_id = v_area)
      ) x
    )
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_equipe_avaliacoes_pdi(int) TO authenticated;

-- ============ (3) get_avaliacao_pdi_gestor: salário sugerido por cargo (quadro) ============
CREATE OR REPLACE FUNCTION public.get_avaliacao_pdi_gestor(p_avaliacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, people, core AS $fn$
DECLARE v_tenant uuid; v_carreira varchar;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;
  SELECT carreira_codigo INTO v_carreira FROM people.avaliacoes_pdi WHERE id=p_avaliacao_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avaliação não encontrada'; END IF;

  RETURN jsonb_build_object(
    'avaliacao', (SELECT to_jsonb(x) FROM (
        SELECT a.id, a.ano, a.status, a.bloqueada, a.faixa_final_geral, a.resultado::text AS resultado,
               a.parecer_gestor, a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at,
               a.gestor_nome, a.progressao_aplicada_at, a.novo_salario, a.novo_cargo_id, a.salario_anterior,
               a.bonus_pdi, a.bonus_performance_plus, a.bonus_comercial,
               a.cargo_id_snapshot, a.cargo_nome_snapshot, a.nivel_codigo_snapshot, a.carreira_codigo,
               a.adicional_snapshot, a.area_nome_snapshot,
               col.nome AS colaborador_nome, col.salario AS salario_atual, col.cargo_id AS cargo_atual_id
        FROM people.avaliacoes_pdi a
        JOIN people.colaboradores col ON col.id = a.colaborador_id
        WHERE a.id = p_avaliacao_id) x),
    'regua', (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.ordem),'[]'::jsonb) FROM people.pdi_faixas_avaliacao f WHERE f.tenant_id=v_tenant),
    'skills', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.trilha, s.pilar_numero, s.item_codigo),'[]'::jsonb) FROM people.avaliacoes_pdi_skills_carreira s WHERE s.avaliacao_pdi_id=p_avaliacao_id),
    'dna', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.numero),'[]'::jsonb) FROM people.avaliacoes_pdi_dna_vlma d WHERE d.avaliacao_pdi_id=p_avaliacao_id),
    'metas', (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.semestre, m.ordem, m.created_at),'[]'::jsonb) FROM people.avaliacoes_pdi_metas_individuais m WHERE m.avaliacao_pdi_id=p_avaliacao_id),
    'feedbacks', (SELECT COALESCE(jsonb_agg(to_jsonb(fb) ORDER BY fb.mes),'[]'::jsonb) FROM people.avaliacoes_pdi_feedbacks_mensais fb WHERE fb.avaliacao_pdi_id=p_avaliacao_id),
    'cargos', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.nivel, c.nome),'[]'::jsonb) FROM (
        SELECT ca.id, ca.nome, ca.codigo, ca.nivel,
               (SELECT qr.salario FROM people.pdi_quadro_remuneracao qr
                 WHERE qr.tenant_id=v_tenant AND qr.carreira_codigo=v_carreira AND qr.cargo_codigo=ca.codigo AND qr.coluna='I'
                 LIMIT 1) AS salario_sugerido
        FROM people.cargos ca WHERE ca.tenant_id=v_tenant AND ca.ativo IS NOT FALSE) c)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_avaliacao_pdi_gestor(uuid) TO authenticated;

-- ============ create_colaborador (+carreira) ============
CREATE OR REPLACE FUNCTION public.create_colaborador(p_user_id uuid, p_colaborador_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_new_user_id UUID;
  v_colaborador_id UUID;
  v_result JSON;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with tenant';
  END IF;

  v_new_user_id := (p_colaborador_data->>'user_id')::UUID;
  v_colaborador_id := gen_random_uuid();

  INSERT INTO people.colaboradores (
    id,
    tenant_id,
    user_id,
    nome,
    email,
    cpf,
    data_nascimento,
    data_entrada,
    data_saida,
    categoria,
    carreira,
    oab,
    whatsapp,
    cep,
    rua,
    numero,
    complemento,
    cidade,
    estado,
    cargo_id,
    area_id,
    adicional,
    percentual_adicional,
    salario,
    banco,
    agencia,
    conta_com_digito,
    chave_pix,
    conta_contabil,
    skills,
    created_by
  ) VALUES (
    v_colaborador_id,
    v_tenant_id,
    v_new_user_id,
    (p_colaborador_data->>'nome')::VARCHAR,
    (p_colaborador_data->>'email')::VARCHAR,
    (p_colaborador_data->>'cpf')::VARCHAR,
    CASE WHEN p_colaborador_data->>'data_nascimento' IS NOT NULL
      THEN (p_colaborador_data->>'data_nascimento')::DATE
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'data_entrada' IS NOT NULL AND p_colaborador_data->>'data_entrada' <> ''
      THEN (p_colaborador_data->>'data_entrada')::DATE
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'data_saida' IS NOT NULL AND p_colaborador_data->>'data_saida' <> ''
      THEN (p_colaborador_data->>'data_saida')::DATE
      ELSE NULL
    END,
    (p_colaborador_data->>'categoria')::people.colaborador_categoria,
    NULLIF(p_colaborador_data->>'carreira','')::VARCHAR,
    CASE WHEN p_colaborador_data->>'oab' IS NOT NULL AND p_colaborador_data->>'oab' != ''
      THEN (p_colaborador_data->>'oab')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'whatsapp' IS NOT NULL AND p_colaborador_data->>'whatsapp' != ''
      THEN (p_colaborador_data->>'whatsapp')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'cep' IS NOT NULL AND p_colaborador_data->>'cep' != ''
      THEN (p_colaborador_data->>'cep')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'rua' IS NOT NULL AND p_colaborador_data->>'rua' != ''
      THEN (p_colaborador_data->>'rua')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'numero' IS NOT NULL AND p_colaborador_data->>'numero' != ''
      THEN (p_colaborador_data->>'numero')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'complemento' IS NOT NULL AND p_colaborador_data->>'complemento' != ''
      THEN (p_colaborador_data->>'complemento')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'cidade' IS NOT NULL AND p_colaborador_data->>'cidade' != ''
      THEN (p_colaborador_data->>'cidade')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'estado' IS NOT NULL AND p_colaborador_data->>'estado' != ''
      THEN (p_colaborador_data->>'estado')::VARCHAR
      ELSE NULL
    END,
    (p_colaborador_data->>'cargo_id')::UUID,
    CASE WHEN p_colaborador_data->>'area_id' IS NOT NULL AND p_colaborador_data->>'area_id' != ''
      THEN (p_colaborador_data->>'area_id')::UUID
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'adicional' IS NOT NULL AND p_colaborador_data->>'adicional' != ''
      THEN (p_colaborador_data->>'adicional')::people.colaborador_adicional
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'percentual_adicional' IS NOT NULL
      THEN (p_colaborador_data->>'percentual_adicional')::DECIMAL(5,2)
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'salario' IS NOT NULL
      THEN (p_colaborador_data->>'salario')::DECIMAL(10,2)
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'banco' IS NOT NULL AND p_colaborador_data->>'banco' != ''
      THEN (p_colaborador_data->>'banco')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'agencia' IS NOT NULL AND p_colaborador_data->>'agencia' != ''
      THEN (p_colaborador_data->>'agencia')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'conta_com_digito' IS NOT NULL AND p_colaborador_data->>'conta_com_digito' != ''
      THEN (p_colaborador_data->>'conta_com_digito')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data->>'chave_pix' IS NOT NULL AND p_colaborador_data->>'chave_pix' != ''
      THEN (p_colaborador_data->>'chave_pix')::VARCHAR
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data ? 'conta_contabil'
      THEN NULLIF(p_colaborador_data->>'conta_contabil', '')
      ELSE NULL
    END,
    CASE WHEN p_colaborador_data ? 'skills'
      THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_colaborador_data->'skills')), ARRAY[]::text[])
      ELSE ARRAY[]::text[]
    END,
    p_user_id
  )
  RETURNING id INTO v_colaborador_id;

  SELECT public.get_colaborador(p_user_id, v_colaborador_id) INTO v_result;

  RETURN v_result;
END;
$function$

;

-- ============ update_colaborador_data (+carreira) ============
CREATE OR REPLACE FUNCTION public.update_colaborador_data(p_user_id uuid, p_colaborador_id uuid, p_update_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_colaborador JSON;
  v_clean_cpf VARCHAR(11);
  v_updated_rows INT;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM people.colaboradores c
    WHERE c.id = p_colaborador_id
      AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Colaborador not found';
  END IF;

  IF p_update_data ? 'cpf' AND p_update_data->>'cpf' IS NOT NULL THEN
    v_clean_cpf := regexp_replace(p_update_data->>'cpf', '[^0-9]', '', 'g');
    IF length(v_clean_cpf) > 11 THEN
      RAISE EXCEPTION 'CPF deve ter no máximo 11 dígitos';
    END IF;
  END IF;

  UPDATE people.colaboradores
  SET
    nome = CASE WHEN p_update_data ? 'nome' THEN (p_update_data->>'nome')::VARCHAR ELSE nome END,
    email = CASE WHEN p_update_data ? 'email' THEN (p_update_data->>'email')::VARCHAR ELSE email END,
    cpf = CASE WHEN p_update_data ? 'cpf' AND v_clean_cpf IS NOT NULL THEN v_clean_cpf ELSE cpf END,
    data_nascimento = CASE WHEN p_update_data ? 'data_nascimento' AND p_update_data->>'data_nascimento' IS NOT NULL THEN (p_update_data->>'data_nascimento')::DATE ELSE data_nascimento END,
    data_entrada = CASE WHEN p_update_data ? 'data_entrada' THEN CASE WHEN COALESCE(p_update_data->>'data_entrada', '') = '' THEN NULL ELSE (p_update_data->>'data_entrada')::DATE END ELSE data_entrada END,
    data_saida = CASE WHEN p_update_data ? 'data_saida' THEN CASE WHEN COALESCE(p_update_data->>'data_saida', '') = '' THEN NULL ELSE (p_update_data->>'data_saida')::DATE END ELSE data_saida END,
    categoria = CASE WHEN p_update_data ? 'categoria' AND p_update_data->>'categoria' IS NOT NULL THEN (p_update_data->>'categoria')::people.colaborador_categoria ELSE categoria END,
    carreira = CASE WHEN p_update_data ? 'carreira' THEN NULLIF(p_update_data->>'carreira','')::VARCHAR ELSE carreira END,
    oab = CASE WHEN p_update_data ? 'oab' THEN CASE WHEN p_update_data->>'oab' = '' THEN NULL ELSE (p_update_data->>'oab')::VARCHAR END ELSE oab END,
    whatsapp = CASE WHEN p_update_data ? 'whatsapp' THEN CASE WHEN p_update_data->>'whatsapp' = '' THEN NULL ELSE (p_update_data->>'whatsapp')::VARCHAR END ELSE whatsapp END,
    cep = CASE WHEN p_update_data ? 'cep' THEN CASE WHEN p_update_data->>'cep' = '' THEN NULL ELSE (p_update_data->>'cep')::VARCHAR END ELSE cep END,
    rua = CASE WHEN p_update_data ? 'rua' THEN CASE WHEN p_update_data->>'rua' = '' THEN NULL ELSE (p_update_data->>'rua')::VARCHAR END ELSE rua END,
    numero = CASE WHEN p_update_data ? 'numero' THEN CASE WHEN p_update_data->>'numero' = '' THEN NULL ELSE (p_update_data->>'numero')::VARCHAR END ELSE numero END,
    complemento = CASE WHEN p_update_data ? 'complemento' THEN CASE WHEN p_update_data->>'complemento' = '' THEN NULL ELSE (p_update_data->>'complemento')::VARCHAR END ELSE complemento END,
    cidade = CASE WHEN p_update_data ? 'cidade' THEN CASE WHEN p_update_data->>'cidade' = '' THEN NULL ELSE (p_update_data->>'cidade')::VARCHAR END ELSE cidade END,
    estado = CASE WHEN p_update_data ? 'estado' THEN CASE WHEN p_update_data->>'estado' = '' THEN NULL ELSE (p_update_data->>'estado')::VARCHAR END ELSE estado END,
    cargo_id = CASE WHEN p_update_data ? 'cargo_id' AND p_update_data->>'cargo_id' IS NOT NULL THEN (p_update_data->>'cargo_id')::UUID ELSE cargo_id END,
    area_id = CASE WHEN p_update_data ? 'area_id' AND p_update_data->>'area_id' IS NOT NULL AND p_update_data->>'area_id' != '' THEN (p_update_data->>'area_id')::UUID ELSE area_id END,
    adicional = CASE WHEN p_update_data ? 'adicional' AND p_update_data->>'adicional' IS NOT NULL AND p_update_data->>'adicional' != '' THEN (p_update_data->>'adicional')::people.colaborador_adicional ELSE adicional END,
    percentual_adicional = CASE WHEN p_update_data ? 'percentual_adicional' AND p_update_data->>'percentual_adicional' IS NOT NULL THEN (p_update_data->>'percentual_adicional')::DECIMAL(5,2) ELSE percentual_adicional END,
    salario = CASE WHEN p_update_data ? 'salario' AND p_update_data->>'salario' IS NOT NULL THEN (p_update_data->>'salario')::DECIMAL(10,2) ELSE salario END,
    banco = CASE WHEN p_update_data ? 'banco' THEN CASE WHEN p_update_data->>'banco' = '' THEN NULL ELSE (p_update_data->>'banco')::VARCHAR END ELSE banco END,
    agencia = CASE WHEN p_update_data ? 'agencia' THEN CASE WHEN p_update_data->>'agencia' = '' THEN NULL ELSE (p_update_data->>'agencia')::VARCHAR END ELSE agencia END,
    conta_com_digito = CASE WHEN p_update_data ? 'conta_com_digito' THEN CASE WHEN p_update_data->>'conta_com_digito' = '' THEN NULL ELSE (p_update_data->>'conta_com_digito')::VARCHAR END ELSE conta_com_digito END,
    chave_pix = CASE WHEN p_update_data ? 'chave_pix' THEN CASE WHEN p_update_data->>'chave_pix' = '' THEN NULL ELSE (p_update_data->>'chave_pix')::VARCHAR END ELSE chave_pix END,
    conta_contabil = CASE WHEN p_update_data ? 'conta_contabil' THEN NULLIF(p_update_data->>'conta_contabil', '') ELSE conta_contabil END,
    skills = CASE WHEN p_update_data ? 'skills' THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_update_data->'skills')), ARRAY[]::text[]) ELSE skills END,
    ativo = CASE WHEN p_update_data ? 'ativo' THEN (p_update_data->>'ativo')::BOOLEAN ELSE ativo END,
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_colaborador_id
    AND tenant_id = v_tenant_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RAISE EXCEPTION 'Failed to update colaborador or colaborador not found after check';
  END IF;

  SELECT public.get_colaborador(p_user_id, p_colaborador_id) INTO v_colaborador;

  RETURN v_colaborador;
END;
$function$

;

-- ============ get_colaborador_complete (+carreira) ============
CREATE OR REPLACE FUNCTION public.get_colaborador_complete(p_user_id uuid, p_colaborador_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_colaborador_row RECORD;
  v_result JSON;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with tenant';
  END IF;

  SELECT
    c.id,
    c.tenant_id,
    c.user_id,
    c.nome,
    c.email,
    c.cpf,
    c.data_nascimento,
    c.data_entrada,
    c.data_saida,
    c.categoria,
    c.carreira,
    COALESCE(c.oab, '') as oab,
    COALESCE(c.whatsapp, '') as whatsapp,
    COALESCE(c.cep, '') as cep,
    COALESCE(c.rua, '') as rua,
    COALESCE(c.numero, '') as numero,
    COALESCE(c.complemento, '') as complemento,
    COALESCE(c.cidade, '') as cidade,
    COALESCE(c.estado, '') as estado,
    c.cargo_id,
    c.area_id,
    c.adicional,
    c.percentual_adicional,
    c.salario,
    COALESCE(c.conta_contabil, '') as conta_contabil,
    COALESCE(c.skills, ARRAY[]::text[]) as skills,
    COALESCE(c.banco, '') as banco,
    COALESCE(c.agencia, '') as agencia,
    COALESCE(c.conta_com_digito, '') as conta_com_digito,
    COALESCE(c.chave_pix, '') as chave_pix,
    c.ativo,
    c.created_at,
    c.updated_at,
    c.created_by,
    c.updated_by,
    car.nome as cargo_nome,
    ar.nome as area_nome
  INTO v_colaborador_row
  FROM people.colaboradores c
  LEFT JOIN people.cargos car ON car.id = c.cargo_id
  LEFT JOIN people.areas ar ON ar.id = c.area_id
  WHERE c.id = p_colaborador_id
    AND c.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador not found';
  END IF;

  SELECT json_build_object(
    'id', v_colaborador_row.id,
    'tenant_id', v_colaborador_row.tenant_id,
    'user_id', v_colaborador_row.user_id,
    'nome', v_colaborador_row.nome,
    'email', v_colaborador_row.email,
    'cpf', v_colaborador_row.cpf,
    'data_nascimento', v_colaborador_row.data_nascimento,
    'data_entrada', v_colaborador_row.data_entrada,
    'data_saida', v_colaborador_row.data_saida,
    'categoria', v_colaborador_row.categoria,
    'carreira', v_colaborador_row.carreira,
    'oab', v_colaborador_row.oab,
    'whatsapp', v_colaborador_row.whatsapp,
    'cep', v_colaborador_row.cep,
    'rua', v_colaborador_row.rua,
    'numero', v_colaborador_row.numero,
    'complemento', v_colaborador_row.complemento,
    'cidade', v_colaborador_row.cidade,
    'estado', v_colaborador_row.estado,
    'cargo_id', v_colaborador_row.cargo_id,
    'area_id', v_colaborador_row.area_id,
    'adicional', v_colaborador_row.adicional,
    'percentual_adicional', v_colaborador_row.percentual_adicional,
    'salario', v_colaborador_row.salario,
    'conta_contabil', v_colaborador_row.conta_contabil,
    'skills', v_colaborador_row.skills,
    'banco', v_colaborador_row.banco,
    'agencia', v_colaborador_row.agencia,
    'conta_com_digito', v_colaborador_row.conta_com_digito,
    'chave_pix', v_colaborador_row.chave_pix,
    'ativo', v_colaborador_row.ativo,
    'created_at', v_colaborador_row.created_at,
    'updated_at', v_colaborador_row.updated_at,
    'created_by', v_colaborador_row.created_by,
    'updated_by', v_colaborador_row.updated_by,
    'cargos', CASE
      WHEN v_colaborador_row.cargo_nome IS NOT NULL
      THEN json_build_object('nome', v_colaborador_row.cargo_nome)
      ELSE NULL
    END,
    'areas', CASE
      WHEN v_colaborador_row.area_nome IS NOT NULL
      THEN json_build_object('nome', v_colaborador_row.area_nome)
      ELSE NULL
    END,
    'colaboradores_beneficios', (
      SELECT COALESCE(json_agg(json_build_object('beneficio', cb.beneficio)), '[]'::json)
      FROM people.colaboradores_beneficios cb
      WHERE cb.colaborador_id = p_colaborador_id
    ),
    'user_roles', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'role_id', ur.role_id,
            'role_nome', r.nome
          )
        ),
        '[]'::json
      )
      FROM core.user_roles ur
      JOIN core.roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_colaborador_row.user_id
        AND ur.tenant_id = v_tenant_id
    ),
    'permissions', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'permission_id', p.id,
            'chave', p.chave,
            'descricao', p.descricao,
            'categoria', p.categoria
          )
        ),
        '[]'::json
      )
      FROM (
        SELECT DISTINCT p.id, p.chave, p.descricao, p.categoria
        FROM core.user_roles ur
        JOIN core.role_permissions rp ON ur.role_id = rp.role_id
        JOIN core.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = v_colaborador_row.user_id
          AND ur.tenant_id = v_tenant_id
          AND p.tenant_id = v_tenant_id
        UNION
        SELECT DISTINCT p.id, p.chave, p.descricao, p.categoria
        FROM core.user_permissions up
        JOIN core.permissions p ON up.permission_id = p.id
        WHERE up.user_id = v_colaborador_row.user_id
          AND up.tenant_id = v_tenant_id
          AND p.tenant_id = v_tenant_id
      ) p
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$

;
