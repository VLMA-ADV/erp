-- Feedback 20/07: "o usuário visualiza apenas o seu PDI (hoje ele consegue ver o de todos)".
-- Causa: people.pdi.write foi concedida amplamente (todo mundo precisa dela para
-- salvar a própria autoavaliação) e pdi_pode_avaliar() tratava a permissão como
-- acesso de gestor; além disso categoria 'administrativo' (inclui Financeiro)
-- via a consolidação inteira com salários.
-- Regra nova: sócio OU administrativo do CC VLMA (RH/diretoria) veem tudo;
-- coordenador de área (eh_coordenador) vê a própria área; o resto vê só o seu PDI.

CREATE OR REPLACE FUNCTION public.pdi_pode_avaliar_uid(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant uuid;
  v_cat people.colaborador_categoria;
  v_coord boolean;
  v_area_nome text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RETURN false; END IF;
  SELECT col.categoria, COALESCE(col.eh_coordenador, false), a.nome
  INTO v_cat, v_coord, v_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
  WHERE col.user_id=p_user_id AND col.tenant_id=v_tenant
  LIMIT 1;
  IF v_cat = 'socio' THEN RETURN true; END IF;
  IF v_cat = 'administrativo' AND v_area_nome = 'VLMA' THEN RETURN true; END IF;
  RETURN COALESCE(v_coord, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pdi_pode_avaliar()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.pdi_pode_avaliar_uid(auth.uid());
$function$;

-- Escopo "vê tudo" alinhado: sócio ou administrativo do CC VLMA; coordenador fica na área.
CREATE OR REPLACE FUNCTION public.get_equipe_avaliacoes_pdi(p_ano integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'people', 'core'
AS $function$
DECLARE v_tenant uuid; v_cat people.colaborador_categoria; v_area uuid; v_area_nome text; v_ve_tudo boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  IF NOT public.pdi_pode_avaliar() THEN RAISE EXCEPTION 'Sem permissão para avaliar equipe'; END IF;

  SELECT col.categoria, col.area_id, a.nome INTO v_cat, v_area, v_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
  WHERE col.user_id=auth.uid() AND col.tenant_id=v_tenant LIMIT 1;

  v_ve_tudo := (v_cat = 'socio') OR (v_cat = 'administrativo' AND v_area_nome = 'VLMA');

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
$function$;
