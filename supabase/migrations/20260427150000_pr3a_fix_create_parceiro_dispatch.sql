-- PR3a: corrigir 42725 ambiguity após apply do PR3 (20260427120000).
--
-- Cursor MCP smoke reportou:
--   ERROR: 42725: function public.create_parceiro(...) is not unique
--   HINT: Could not choose a best candidate function.
--
-- Diagnóstico: o wrapper de 22 params tem `p_categoria_prestador_parceiro_id uuid
-- DEFAULT NULL`. Calls de 21 args (incluindo a delegação interna do wrapper para A
-- e calls externos com 21 named args) são ambíguas entre:
--   - overload A (21 params exatos, com p_cep)
--   - novo wrapper (22 params, último com DEFAULT → aceita 21 args com 1 default)
--
-- A presunção de que PG resolve preferindo exact-arg-count está errada: o name-arg
-- dispatch trata wrapper-com-default como candidato igualmente válido a A, e a etapa
-- de eliminação por DEFAULT só acontece quando outras desempates já passaram. Para
-- as assinaturas idênticas em nome+tipos dos primeiros 21 params, nenhum desempate
-- anterior vence — daí 42725.
--
-- Fix em 2 passos (idempotente):
--  1) ALTER FUNCTION ... RENAME TO create_parceiro_v1: renomeia A para um nome
--     único, sem mudar body/permissions/owner. Após isto, public.create_parceiro
--     refere-se exclusivamente ao wrapper de 22 params — calls externos resolvem
--     unicamente. Calls antigos de 21 args para `create_parceiro` cairão no wrapper
--     usando default NULL para categoria, comportamento equivalente a antes.
--  2) CREATE OR REPLACE do wrapper com body chamando `public.create_parceiro_v1`
--     direto (zero ambiguidade — v1 tem signature única). Mantém DEFAULT NULL no
--     último param do wrapper porque agora não há conflito.
--
-- REVOKE/GRANT replicado para create_parceiro_v1 (preservar acesso da edge).
-- Backward-compat: nenhum DROP de coluna nem mudança de tipo (ADR-008 ok).

-- ============================================================================
-- Step 1: rename overload A → create_parceiro_v1 (sem mexer no body)
-- ============================================================================
ALTER FUNCTION public.create_parceiro(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar
) RENAME TO create_parceiro_v1;

-- Replicar permissões padrão para v1 (defensivo, caso o ALTER não preserve grants
-- de service_role/authenticated em todos os caminhos).
REVOKE ALL ON FUNCTION public.create_parceiro_v1(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_parceiro_v1(
  uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  varchar, varchar, varchar, varchar
) TO authenticated, service_role;

-- ============================================================================
-- Step 2: CREATE OR REPLACE do wrapper, agora delegando para create_parceiro_v1
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
  -- Delega à create_parceiro_v1 (signature única após rename — zero ambiguidade).
  v_result := public.create_parceiro_v1(
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

-- Permissões do wrapper (idempotente — o REVOKE/GRANT do PR3 já estabeleceu, mas
-- repetir é seguro).
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
