-- Fix bug clientes: potencial_cliente (sem coluna/param) + responsáveis financeiros só salvavam com nome (guard) + nome NOT NULL protegido com coalesce.
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS potencial_cliente varchar;

CREATE OR REPLACE FUNCTION public.create_cliente(p_user_id uuid, p_nome character varying, p_cliente_estrangeiro boolean DEFAULT false, p_cnpj character varying DEFAULT NULL::character varying, p_tipo crm.cliente_tipo DEFAULT NULL::crm.cliente_tipo, p_rua character varying DEFAULT NULL::character varying, p_numero character varying DEFAULT NULL::character varying, p_complemento character varying DEFAULT NULL::character varying, p_bairro character varying DEFAULT NULL::character varying, p_cidade character varying DEFAULT NULL::character varying, p_estado character varying DEFAULT NULL::character varying, p_cep character varying DEFAULT NULL::character varying, p_codigo_ibge character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_telefone character varying DEFAULT NULL::character varying, p_regime_fiscal character varying DEFAULT NULL::character varying, p_grupo_economico_id uuid DEFAULT NULL::uuid, p_observacoes text DEFAULT NULL::text, p_segmento_ids uuid[] DEFAULT NULL::uuid[], p_resp_int_nome character varying DEFAULT NULL::character varying, p_resp_int_email character varying DEFAULT NULL::character varying, p_resp_int_whatsapp character varying DEFAULT NULL::character varying, p_resp_int_data_nascimento date DEFAULT NULL::date, p_resp_fin_nome character varying DEFAULT NULL::character varying, p_resp_fin_email character varying DEFAULT NULL::character varying, p_resp_fin_whatsapp character varying DEFAULT NULL::character varying, p_responsaveis_financeiros jsonb DEFAULT NULL::jsonb, p_potencial_cliente character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'crm'
AS $function$
declare
  v_tenant_id uuid;
  v_id uuid;
  v_segmento_id uuid;
  v_rf jsonb;
begin
  select tu.tenant_id into v_tenant_id
  from core.tenant_users tu
  where tu.user_id = p_user_id and tu.status = 'ativo'
  limit 1;

  if v_tenant_id is null then
    raise exception 'User not associated with tenant';
  end if;

  if p_cliente_estrangeiro = false and p_cnpj is null then
    raise exception 'CNPJ é obrigatório para cliente não estrangeiro';
  end if;

  if p_cnpj is not null and exists (
    select 1 from crm.clientes c
    where c.tenant_id = v_tenant_id and c.cnpj = p_cnpj
  ) then
    raise exception 'CNPJ já existe para este tenant';
  end if;

  insert into crm.clientes (
    tenant_id, nome, cliente_estrangeiro, cnpj, tipo,
    cep, rua, numero, complemento, bairro, cidade, estado,
    codigo_ibge, email, telefone, potencial_cliente,
    regime_fiscal, grupo_economico_id, observacoes,
    ativo, created_by, updated_by
  ) values (
    v_tenant_id, p_nome, p_cliente_estrangeiro, p_cnpj, p_tipo,
    p_cep, p_rua, p_numero, p_complemento, p_bairro, p_cidade, p_estado,
    p_codigo_ibge, p_email, p_telefone, p_potencial_cliente,
    p_regime_fiscal, p_grupo_economico_id, p_observacoes,
    true, p_user_id, p_user_id
  )
  returning crm.clientes.id into v_id;

  if p_segmento_ids is not null then
    foreach v_segmento_id in array p_segmento_ids loop
      insert into crm.clientes_segmentos (cliente_id, segmento_id)
      values (v_id, v_segmento_id)
      on conflict do nothing;
    end loop;
  end if;

  if p_resp_int_nome is not null then
    insert into crm.clientes_responsaveis_internos (
      cliente_id, nome, email, whatsapp, data_nascimento
    ) values (
      v_id, p_resp_int_nome, p_resp_int_email, p_resp_int_whatsapp, p_resp_int_data_nascimento
    );
  end if;

  if p_responsaveis_financeiros is not null then
    for v_rf in select * from jsonb_array_elements(p_responsaveis_financeiros) loop
      if coalesce(length(v_rf->>'nome'),0) > 0 or coalesce(length(v_rf->>'email'),0) > 0 or coalesce(length(v_rf->>'whatsapp'),0) > 0 then
        insert into crm.clientes_responsaveis_financeiros (
          cliente_id, nome, email, whatsapp
        ) values (
          v_id,
          coalesce(v_rf->>'nome',''),
          nullif(v_rf->>'email', ''),
          nullif(v_rf->>'whatsapp', '')
        );
      end if;
    end loop;
  elsif p_resp_fin_nome is not null then
    insert into crm.clientes_responsaveis_financeiros (
      cliente_id, nome, email, whatsapp
    ) values (
      v_id, p_resp_fin_nome, p_resp_fin_email, p_resp_fin_whatsapp
    );
  end if;

  return public.get_cliente(p_user_id, v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_cliente(p_user_id uuid, p_cliente_id uuid, p_nome character varying, p_cliente_estrangeiro boolean DEFAULT false, p_cnpj character varying DEFAULT NULL::character varying, p_tipo crm.cliente_tipo DEFAULT NULL::crm.cliente_tipo, p_rua character varying DEFAULT NULL::character varying, p_numero character varying DEFAULT NULL::character varying, p_complemento character varying DEFAULT NULL::character varying, p_bairro character varying DEFAULT NULL::character varying, p_cidade character varying DEFAULT NULL::character varying, p_estado character varying DEFAULT NULL::character varying, p_cep character varying DEFAULT NULL::character varying, p_codigo_ibge character varying DEFAULT NULL::character varying, p_email character varying DEFAULT NULL::character varying, p_telefone character varying DEFAULT NULL::character varying, p_regime_fiscal character varying DEFAULT NULL::character varying, p_grupo_economico_id uuid DEFAULT NULL::uuid, p_observacoes text DEFAULT NULL::text, p_segmento_ids uuid[] DEFAULT NULL::uuid[], p_resp_int_nome character varying DEFAULT NULL::character varying, p_resp_int_email character varying DEFAULT NULL::character varying, p_resp_int_whatsapp character varying DEFAULT NULL::character varying, p_resp_int_data_nascimento date DEFAULT NULL::date, p_resp_fin_nome character varying DEFAULT NULL::character varying, p_resp_fin_email character varying DEFAULT NULL::character varying, p_resp_fin_whatsapp character varying DEFAULT NULL::character varying, p_responsaveis_financeiros jsonb DEFAULT NULL::jsonb, p_potencial_cliente character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'crm'
AS $function$
declare
  v_tenant_id uuid;
  v_existing record;
  v_segmento_id uuid;
  v_rf jsonb;
begin
  select tu.tenant_id into v_tenant_id
  from core.tenant_users tu
  where tu.user_id = p_user_id and tu.status = 'ativo'
  limit 1;

  if v_tenant_id is null then
    raise exception 'User not associated with tenant';
  end if;

  select c.* into v_existing
  from crm.clientes c
  where c.id = p_cliente_id and c.tenant_id = v_tenant_id;

  if not found then
    raise exception 'Cliente não encontrado';
  end if;

  if p_cliente_estrangeiro = false and p_cnpj is null then
    raise exception 'CNPJ é obrigatório para cliente não estrangeiro';
  end if;

  if p_cnpj is not null and p_cnpj <> v_existing.cnpj and exists (
    select 1 from crm.clientes c
    where c.tenant_id = v_tenant_id
      and c.cnpj = p_cnpj
      and c.id <> p_cliente_id
  ) then
    raise exception 'CNPJ já existe para outro cliente';
  end if;

  update crm.clientes c
  set
    nome = p_nome,
    cliente_estrangeiro = p_cliente_estrangeiro,
    cnpj = p_cnpj,
    tipo = p_tipo,
    cep = p_cep,
    rua = p_rua,
    numero = p_numero,
    complemento = p_complemento,
    bairro = p_bairro,
    cidade = p_cidade,
    estado = p_estado,
    codigo_ibge = p_codigo_ibge,
    email = p_email,
    potencial_cliente = p_potencial_cliente,
    telefone = p_telefone,
    regime_fiscal = p_regime_fiscal,
    grupo_economico_id = p_grupo_economico_id,
    observacoes = p_observacoes,
    updated_by = p_user_id,
    updated_at = now()
  where c.id = p_cliente_id and c.tenant_id = v_tenant_id;

  delete from crm.clientes_segmentos cs where cs.cliente_id = p_cliente_id;
  if p_segmento_ids is not null then
    foreach v_segmento_id in array p_segmento_ids loop
      insert into crm.clientes_segmentos (cliente_id, segmento_id)
      values (p_cliente_id, v_segmento_id)
      on conflict do nothing;
    end loop;
  end if;

  delete from crm.clientes_responsaveis_internos ri where ri.cliente_id = p_cliente_id;
  if p_resp_int_nome is not null then
    insert into crm.clientes_responsaveis_internos (
      cliente_id, nome, email, whatsapp, data_nascimento
    ) values (
      p_cliente_id, p_resp_int_nome, p_resp_int_email, p_resp_int_whatsapp, p_resp_int_data_nascimento
    );
  end if;

  delete from crm.clientes_responsaveis_financeiros rf where rf.cliente_id = p_cliente_id;

  if p_responsaveis_financeiros is not null then
    for v_rf in select * from jsonb_array_elements(p_responsaveis_financeiros) loop
      if coalesce(length(v_rf->>'nome'),0) > 0 or coalesce(length(v_rf->>'email'),0) > 0 or coalesce(length(v_rf->>'whatsapp'),0) > 0 then
        insert into crm.clientes_responsaveis_financeiros (
          cliente_id, nome, email, whatsapp
        ) values (
          p_cliente_id,
          coalesce(v_rf->>'nome',''),
          nullif(v_rf->>'email', ''),
          nullif(v_rf->>'whatsapp', '')
        );
      end if;
    end loop;
  elsif p_resp_fin_nome is not null then
    insert into crm.clientes_responsaveis_financeiros (
      cliente_id, nome, email, whatsapp
    ) values (
      p_cliente_id, p_resp_fin_nome, p_resp_fin_email, p_resp_fin_whatsapp
    );
  end if;

  return public.get_cliente(p_user_id, p_cliente_id);
end;
$function$;
