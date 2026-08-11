-- Pessoas elegiveis a lote de despesa.
--
-- O lote e por usuario, e list-colaboradores nao devolve o user_id — cruzar por
-- nome seria fragil e quebraria em qualquer homonimo. Uma funcao propria evita
-- mexer na edge function (que so sobe no deploy manual) e devolve exatamente o
-- que a tela precisa.
CREATE OR REPLACE FUNCTION public.get_pessoas_para_lote(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people', 'finance'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', tu.user_id, 'nome', col.nome)
                     ORDER BY col.nome)
    FROM core.tenant_users tu
    JOIN people.colaboradores col
      ON col.user_id = tu.user_id AND col.tenant_id = tu.tenant_id
    WHERE tu.tenant_id = v_tenant_id
      AND tu.status = 'ativo'
      AND COALESCE(col.ativo, true)
  ), '[]'::jsonb);
END;
$function$;
