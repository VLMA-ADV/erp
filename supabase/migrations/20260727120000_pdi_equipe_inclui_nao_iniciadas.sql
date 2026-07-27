-- PDI — lista da equipe passa a mostrar TODAS as pessoas do escopo, inclusive quem
-- ainda não iniciou a avaliação.
--
-- Bug (Tiago Ecker não via Aline/Thaís): a avaliação só nasce quando o PRÓPRIO
-- colaborador abre "Meu PDI" (get_minha_avaliacao_pdi faz o INSERT). A lista da
-- equipe partia de people.avaliacoes_pdi, então quem nunca abriu simplesmente não
-- existia para o gestor — 24 de 51 pessoas tinham avaliação em 2026, ou seja, 27
-- invisíveis para toda a gestão. NÃO era problema de área nem de permissão.
--
-- Fix (somente leitura, sem criar avaliação): a consulta passa a partir dos
-- COLABORADORES do escopo e anexa a avaliação quando existir (LEFT JOIN).
-- Quem não tem vem com id NULL e status 'nao_iniciada' — o front mostra o selo e
-- não deixa clicar (não há avaliação para abrir).
--
-- Cuidados deliberados:
--  * `col.ativo OR a.id IS NOT NULL` — não perde avaliação de alguém já desligado
--    (hoje são 0, mas evita regressão futura de sumir com registro existente).
--  * cargo/área caem para o cadastro atual quando não há snapshot, só para a linha
--    não ficar vazia.
--  * adicional_snapshot continua vindo SÓ do snapshot da avaliação. Quem não
--    iniciou vem com null — de propósito, para não ampliar a exposição de dado de
--    folha (decisão pendente com o cliente).
--  * escopo (v_ve_tudo / área) mantido exatamente como estava.
--
-- Também devolve total_pessoas e iniciadas, para a tela mostrar "X de Y iniciadas"
-- (hoje o número de avaliações é lido como se fosse o quadro inteiro).

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
    'total_pessoas', (
      SELECT count(*) FROM people.colaboradores col
      WHERE col.tenant_id = v_tenant AND col.ativo
        AND (v_ve_tudo OR col.area_id = v_area)
    ),
    'iniciadas', (
      SELECT count(*) FROM people.avaliacoes_pdi a
      JOIN people.colaboradores col ON col.id = a.colaborador_id
      WHERE a.tenant_id = v_tenant AND a.ano = p_ano
        AND (v_ve_tudo OR col.area_id = v_area)
    ),
    'itens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.colaborador_nome), '[]'::jsonb) FROM (
        SELECT a.id,
               COALESCE(a.status::text, 'nao_iniciada') AS status,
               a.faixa_final_geral,
               a.resultado::text AS resultado,
               a.autoavaliacao_enviada_at, a.avaliacao_gestor_enviada_at, a.progressao_aplicada_at,
               COALESCE(a.cargo_nome_snapshot, cg.nome) AS cargo_nome_snapshot,
               COALESCE(a.area_nome_snapshot, ar.nome) AS area_nome_snapshot,
               a.carreira_codigo,
               a.adicional_snapshot,
               col.nome AS colaborador_nome,
               col.categoria::text AS categoria
        FROM people.colaboradores col
        LEFT JOIN people.avaliacoes_pdi a
               ON a.colaborador_id = col.id AND a.ano = p_ano AND a.tenant_id = v_tenant
        LEFT JOIN people.cargos cg ON cg.id = col.cargo_id
        LEFT JOIN people.areas ar ON ar.id = col.area_id AND ar.tenant_id = v_tenant
        WHERE col.tenant_id = v_tenant
          AND (v_ve_tudo OR col.area_id = v_area)
          AND (col.ativo OR a.id IS NOT NULL)
      ) x
    )
  );
END;
$function$;
