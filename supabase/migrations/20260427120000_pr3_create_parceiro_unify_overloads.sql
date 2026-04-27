-- PR3 / Bug D: Resolver "Could not find function public.create_parceiro(...) in schema cache"
-- em /pessoas/parceiros/novo (Filipe, prod 2026-04-25).
--
-- Causa raiz: a edge `create-parceiro` deployed em DEV chama `public.create_parceiro` com
-- 22 params nomeados (incluindo p_cep E p_categoria_prestador_parceiro_id), espelhando o
-- shape de `update_parceiro`. Mas o DB tem 2 overloads de 21 params cada:
--   A) (p_user_id, ..., p_cep, ..., p_chave_pix)            — com p_cep, sem categoria
--   B) (p_user_id, ..., p_chave_pix, p_categoria...)         — com categoria, sem p_cep
-- Nenhum aceita os 22 simultaneamente, e PostgREST rejeita com "schema cache".
--
-- Cursor confirmou pg_depend vazio para os overloads atuais (nenhum view/trigger/função
-- depende deles). DROP simples seguro, sem CASCADE.
--
-- Fix em 2 passos (idempotente, backward-compat — ADR-008):
--   1) CREATE OR REPLACE de novo overload de 22 params que aceita o shape exato enviado
--      pela edge (p_cep + p_categoria juntos). Body delega ao overload A via named args
--      (PG dispatch escolhe A: p_cep e p_chave_pix presentes só em A; new overload tem
--      categoria default mas PG prefere match com arg count exato) e aplica p_categoria
--      via UPDATE direto em operations.parceiros quando informada.
--   2) DROP de overload B — funcionalmente substituído pelo novo (que cobre p_cep +
--      categoria), e nenhum chamador depende de B (pg_depend vazio).
-- Overload A (com p_cep) é mantido pois o wrapper delega a ele e re-escrever exigiria o
-- source do body, que MCP atual não extrai via pg_get_functiondef. Rationalização total
-- (consolidar A no wrapper) pode ser follow-up uma vez que a body de A esteja disponível.

-- ============================================================================
-- Step 1: novo overload unificado (22 params)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_parceiro(
  p_user_id uuid,
  p_nome_escritorio character varying,
  p_cnpj character varying,
  p_rua character varying DEFAULT NULL,
  p_numero character varying DEFAULT NULL,
  p_complemento character varying DEFAULT NULL,
  p_cidade character varying DEFAULT NULL,
  p_estado character varying DEFAULT NULL,
  p_cep character varying DEFAULT NULL,
  p_adv_nome character varying DEFAULT NULL,
  p_adv_email character varying DEFAULT NULL,
  p_adv_oab character varying DEFAULT NULL,
  p_adv_cpf character varying DEFAULT NULL,
  p_adv_whatsapp character varying DEFAULT NULL,
  p_fin_nome character varying DEFAULT NULL,
  p_fin_email character varying DEFAULT NULL,
  p_fin_whatsapp character varying DEFAULT NULL,
  p_banco character varying DEFAULT NULL,
  p_conta_com_digito character varying DEFAULT NULL,
  p_agencia character varying DEFAULT NULL,
  p_chave_pix character varying DEFAULT NULL,
  p_categoria_prestador_parceiro_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_result jsonb;
  v_parceiro_id uuid;
BEGIN
  -- Delega criação principal ao overload A (21 params, com p_cep, sem categoria).
  -- Named args + presença de p_cep desambiguam: B não tem p_cep; novo overload (22)
  -- exige default em p_categoria, e PG prefere match com arg count exato → A vence.
  v_result := public.create_parceiro(
    p_user_id          := p_user_id,
    p_nome_escritorio  := p_nome_escritorio,
    p_cnpj             := p_cnpj,
    p_rua              := p_rua,
    p_numero           := p_numero,
    p_complemento      := p_complemento,
    p_cidade           := p_cidade,
    p_estado           := p_estado,
    p_cep              := p_cep,
    p_adv_nome         := p_adv_nome,
    p_adv_email        := p_adv_email,
    p_adv_oab          := p_adv_oab,
    p_adv_cpf          := p_adv_cpf,
    p_adv_whatsapp     := p_adv_whatsapp,
    p_fin_nome         := p_fin_nome,
    p_fin_email        := p_fin_email,
    p_fin_whatsapp     := p_fin_whatsapp,
    p_banco            := p_banco,
    p_conta_com_digito := p_conta_com_digito,
    p_agencia          := p_agencia,
    p_chave_pix        := p_chave_pix
  );

  -- Aplica categoria diretamente em operations.parceiros se informada.
  IF p_categoria_prestador_parceiro_id IS NOT NULL THEN
    v_parceiro_id := NULLIF(v_result->'parceiro'->>'id', '')::uuid;
    IF v_parceiro_id IS NOT NULL THEN
      UPDATE operations.parceiros
         SET categoria_prestador_parceiro_id = p_categoria_prestador_parceiro_id
       WHERE id = v_parceiro_id;
      v_result := jsonb_set(
        v_result,
        '{parceiro,categoria_prestador_parceiro_id}',
        to_jsonb(p_categoria_prestador_parceiro_id::text)
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_parceiro(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_parceiro(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, uuid
) TO authenticated, service_role;

-- ============================================================================
-- Step 2: DROP do overload B (categoria, sem p_cep) — substituído pelo wrapper
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_parceiro(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, uuid
);
