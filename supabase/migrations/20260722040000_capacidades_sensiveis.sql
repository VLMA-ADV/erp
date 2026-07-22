-- Fase de segurança — camada de controle de acesso a ações sensíveis.
--
-- PROBLEMA: get_user_permissions concede TODAS as permissões a quem é
-- 'socio' OU 'administrativo'. Como o administrativo é um perfil amplo,
-- ações realmente sensíveis (ver salário/dados bancários, emitir NF,
-- resetar senha de terceiros, criar colaborador) ficavam liberadas a
-- qualquer administrativo. Este arquivo cria uma camada de autorização
-- DEDICADA que NÃO passa pelo blanket administrativo→tudo.
--
-- Regras confirmadas pelo cliente (Filipe, 22/07/2026):
--   users.reset_password  -> Sócios
--   people.create         -> apenas Filipe (nem os demais sócios)
--   finance.nfse.manage   -> Sócios + Jessika Lira
--   people.salario.read   -> Sócios + Jessika Lira

-- 1) Grants nominais (concessões pontuais a uma conta específica).
--    Regras baseadas em cargo (socio) são resolvidas na função, não aqui.
CREATE TABLE IF NOT EXISTS core.capacidades_sensiveis (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  capacidade  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, capacidade)
);

COMMENT ON TABLE core.capacidades_sensiveis IS
  'Concessões nominais de ações sensíveis. Ver public.tem_capacidade_sensivel.';

-- 2) Checagem de autorização — fonte única de verdade para ações sensíveis.
--    Retorna TRUE só se: (a) a categoria do colaborador implica a capacidade,
--    OU (b) existe grant nominal explícito. Nunca herda do blanket.
CREATE OR REPLACE FUNCTION public.tem_capacidade_sensivel(
  p_user_id    uuid,
  p_capacidade text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_categoria text;
BEGIN
  IF p_user_id IS NULL OR p_capacidade IS NULL THEN
    RETURN false;
  END IF;

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.categoria::text INTO v_categoria
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id
    AND c.tenant_id = v_tenant_id
  LIMIT 1;

  -- Regra por cargo: sócio pode resetar senha, gerenciar NFS-e e ver salário.
  -- (people.create NÃO é implicado por cargo — é nominal, só Filipe.)
  IF v_categoria = 'socio'
     AND p_capacidade IN ('users.reset_password',
                          'finance.nfse.manage',
                          'people.salario.read') THEN
    RETURN true;
  END IF;

  -- Grants nominais explícitos.
  RETURN EXISTS (
    SELECT 1
    FROM core.capacidades_sensiveis g
    WHERE g.user_id = p_user_id
      AND g.tenant_id = v_tenant_id
      AND g.capacidade = p_capacidade
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tem_capacidade_sensivel(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tem_capacidade_sensivel(uuid, text) TO authenticated, service_role;

-- 3) Seed dos grants nominais (idempotente).
--    Jessika Lira -> NFS-e + salário; Filipe -> criar colaborador.
INSERT INTO core.capacidades_sensiveis (tenant_id, user_id, capacidade)
SELECT c.tenant_id, c.user_id, v.capacidade
FROM (VALUES
  ('jessika.lira@vlma.com.br', 'finance.nfse.manage'),
  ('jessika.lira@vlma.com.br', 'people.salario.read'),
  ('filipe@voalegal.com.br',   'people.create')
) AS v(email, capacidade)
JOIN people.colaboradores c ON c.email = v.email
WHERE c.user_id IS NOT NULL
ON CONFLICT (tenant_id, user_id, capacidade) DO NOTHING;
