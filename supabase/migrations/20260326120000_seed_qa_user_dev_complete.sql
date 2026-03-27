-- Seed: usuário QA para ambiente de desenvolvimento (login + tenant + sócio + colaborador).
-- IMPORTANTE: usar APENAS em DEV. Ajuste e-mail/senha antes se necessário.
-- Motivo do registro em people.colaboradores: public.get_user_permissions() retorna todas
-- as permissões do tenant quando categoria = socio | administrativo (ver migration get_user_permissions).

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_tenant uuid := 'd51463dd-a6b3-40e7-9488-854eba80a210';
  v_role_socio uuid := '63557fbb-a891-48dc-9c4c-3886e447ee0b';
  v_cargo uuid := 'fdca0cc9-af58-42d6-b0ec-7ef5f52974d0';
  v_email text := 'qa.vlma.teste@local.dev';
  v_cpf text := '82931456010';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(v_email)) THEN
    RAISE NOTICE 'Usuário QA já existe: %', v_email;

    SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email) LIMIT 1;
  ELSE
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmation_token, recovery_token,
      email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, reauthentication_token
    ) VALUES (
      v_uid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
      v_email, crypt('VLMA_QA_Test_2026!', gen_salt('bf')),
      now(), '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"email_verified":true}'::jsonb,
      now(), now(), ''
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_uid::text, v_uid,
      jsonb_build_object(
        'sub', v_uid::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email', now(), now(), now()
    );

    INSERT INTO core.tenant_users (id, tenant_id, user_id, status, created_at, updated_at)
    VALUES (
      gen_random_uuid(), v_tenant, v_uid,
      'ativo'::core.tenant_user_status, now(), now()
    );

    INSERT INTO core.user_roles (id, tenant_id, user_id, role_id, created_at)
    VALUES (gen_random_uuid(), v_tenant, v_uid, v_role_socio, now());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM people.colaboradores WHERE user_id = v_uid) THEN
    INSERT INTO people.colaboradores (
      tenant_id, user_id, nome, categoria, cpf, email, cargo_id
    ) VALUES (
      v_tenant, v_uid,
      'QA VLMA (teste automatizado)',
      'socio'::people.colaborador_categoria,
      v_cpf,
      v_email,
      v_cargo
    );
  END IF;
END $$;
