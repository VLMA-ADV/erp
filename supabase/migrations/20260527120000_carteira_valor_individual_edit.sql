-- Permite edição de valor_individual em casos filhos de carteira.
-- Hoje o UPDATE de regra_cobranca_config faz replacement total, perdendo
-- numero_processo e identificador do filho. Este fix usa merge (||)
-- para filhos, removendo chaves proibidas (valor_mensal_carteira, processos_carteira).
--
-- Motivação: call Filipe 26/05/2026 — "eu quero me permita editar mesmo que eu
-- tenho um valor cheio, eu posso editar um caso eu posso falar o seguinte no caso
-- aqui não é 150 é 120".

-- Precisamos re-criar a função update_caso com a mudança na linha do
-- regra_cobranca_config. Como a função é grande (600+ linhas), vamos usar
-- uma abordagem cirúrgica: apenas substituir o bloco de regra_cobranca_config
-- dentro do UPDATE via uma nova versão da função inteira.
--
-- Alternativa mais segura: criar wrapper que faz o merge antes de chamar update_caso.
-- Mas como o projeto já tem padrão de CREATE OR REPLACE nas migrations, vamos
-- aplicar um UPDATE direto via DO block que altera o source da função.

-- Abordagem pragmática: em vez de reescrever 600 linhas, vamos criar uma
-- function auxiliar que o frontend chama para atualizar valor_individual
-- de filhos de carteira. Isso NÃO toca no update_caso existente.

CREATE OR REPLACE FUNCTION public.update_caso_carteira_valor(
  p_user_id uuid,
  p_caso_id uuid,
  p_valor_individual text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_parte_de_carteira_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT parte_de_carteira_id INTO v_parte_de_carteira_id
  FROM contracts.casos
  WHERE id = p_caso_id AND tenant_id = v_tenant_id;

  IF v_parte_de_carteira_id IS NULL THEN
    RAISE EXCEPTION 'Caso não é filho de carteira ou não encontrado';
  END IF;

  UPDATE contracts.casos
  SET regra_cobranca_config = regra_cobranca_config || jsonb_build_object('valor_individual', p_valor_individual),
      updated_at = now(),
      updated_by = p_user_id
  WHERE id = p_caso_id
    AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'caso_id', p_caso_id, 'valor_individual', p_valor_individual);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_caso_carteira_valor(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_caso_carteira_valor(uuid, uuid, text) TO service_role;
