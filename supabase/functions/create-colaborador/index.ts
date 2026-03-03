import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get user's tenant usando função RPC
    const { data: tenantUserData, error: tenantError } = await supabase
      .rpc('get_user_tenant', { p_user_id: user.id });
    
    const tenantUser = tenantUserData && tenantUserData.length > 0 
      ? { tenant_id: tenantUserData[0].tenant_id } 
      : null;

    if (tenantError) {
      console.error("Tenant error:", tenantError);
      return new Response(
        JSON.stringify({ 
          error: "User not associated with tenant", 
          details: tenantError.message 
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!tenantUser) {
      return new Response(
        JSON.stringify({ error: "User not associated with tenant" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check permission usando função RPC
    const { data: permissionsData, error: permissionsError } = await supabase
      .rpc('get_user_permissions', { p_user_id: user.id });

    if (permissionsError) {
      console.error("Permissions error:", permissionsError);
      // Não bloquear se não houver permissões específicas, apenas logar
    }

    // Verificar se tem permissões (opcional, não bloquear por enquanto)
    const hasCreatePermission = permissionsData?.some((p: any) => 
      p.permission_key === 'people.colaboradores.write' ||
      p.permission_key === 'people.colaboradores.*'
    );

    if (!hasCreatePermission && permissionsData && permissionsData.length > 0) {
      console.warn("User does not have explicit create permissions for collaborators.");
    }

    const body = await req.json();
    const {
      email,
      password,
      nome,
      data_nascimento,
      categoria,
      cpf,
      oab,
      cep,
      rua,
      numero,
      complemento,
      cidade,
      estado,
      whatsapp,
      area_id,
      cargo_id,
      adicional,
      percentual_adicional,
      salario,
      banco,
      conta_com_digito,
      agencia,
      chave_pix,
      beneficios,
      role_ids,
    } = body;

    // Validate required fields
    if (!email || !password || !nome || !categoria || !cpf || !cargo_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate CPF format (11 digits)
    const cpfClean = cpf.replace(/\D/g, "");
    if (cpfClean.length !== 11) {
      return new Response(
        JSON.stringify({ error: "CPF must have 11 digits" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate OAB for advogado
    if (categoria === "advogado" && !oab) {
      return new Response(
        JSON.stringify({ error: "OAB is required for advogado category" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if email already exists - verificar na tabela colaboradores primeiro
    // (mais confiável que a API REST do auth)
    const { data: existingColab, error: colabCheckError } = await supabase
      .rpc('check_email_exists_in_colaboradores', {
        p_user_id: user.id,
        p_email: email.toLowerCase().trim()
      });

    if (colabCheckError) {
      console.error("Error checking email in colaboradores:", colabCheckError);
      // Continuar mesmo se a verificação falhar
    } else if (existingColab === true) {
      return new Response(
        JSON.stringify({ error: "Email already exists in colaboradores" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Também verificar no auth usando API REST (case-insensitive)
    try {
      const adminResponse = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email.toLowerCase().trim())}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (adminResponse.ok) {
        const adminData = await adminResponse.json();
        console.log("Auth API response for email check:", JSON.stringify(adminData));
        
        // Verificar se realmente existe um usuário com esse email (case-insensitive)
        if (adminData.users && Array.isArray(adminData.users)) {
          const matchingUser = adminData.users.find((u: any) => 
            u.email && u.email.toLowerCase().trim() === email.toLowerCase().trim()
          );
          
          if (matchingUser) {
            console.log("Found existing user:", matchingUser.id, matchingUser.email);
            return new Response(
              JSON.stringify({ 
                error: "Email already exists",
                details: `User ID: ${matchingUser.id}`
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
        }
      } else {
        const errorText = await adminResponse.text();
        console.log("Auth API error response:", errorText);
      }
    } catch (emailCheckError) {
      console.error("Error checking email in auth:", emailCheckError);
      // Continuar mesmo se a verificação falhar - não bloquear criação
    }

    // Check if CPF already exists usando função RPC
    const { data: cpfExists, error: cpfCheckError } = await supabase
      .rpc('check_cpf_exists', { 
        p_user_id: user.id,
        p_cpf: cpfClean 
      });

    if (cpfCheckError) {
      console.error("CPF check error:", cpfCheckError);
      return new Response(
        JSON.stringify({ 
          error: "Error checking CPF", 
          details: cpfCheckError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (cpfExists) {
      return new Response(
        JSON.stringify({ error: "CPF already exists" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create user in auth usando API REST do Supabase Admin
    let newUser;
    try {
      const createUserResponse = await fetch(
        `${supabaseUrl}/auth/v1/admin/users`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
          }),
        }
      );

      if (!createUserResponse.ok) {
        const errorData = await createUserResponse.json();
        return new Response(
          JSON.stringify({ 
            error: errorData.message || errorData.error_description || "Failed to create user" 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const createUserData = await createUserResponse.json();
      console.log("User created in Auth:", createUserData?.id || "undefined");
      console.log("Full response:", JSON.stringify(createUserData));
      
      // A API Admin do Supabase retorna o usuário diretamente, não dentro de { user: ... }
      newUser = createUserData;
    } catch (createUserError: any) {
      console.error("Error creating user:", createUserError);
      return new Response(
        JSON.stringify({ 
          error: createUserError?.message || "Failed to create user" 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!newUser?.id) {
      console.error("No user ID in response:", JSON.stringify(newUser));
      return new Response(
        JSON.stringify({ 
          error: "Failed to create user - no user ID returned",
          details: `Response: ${JSON.stringify(newUser)}`
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Limpar formatação do CEP antes de enviar
    const cleanCEP = body.cep ? body.cep.replace(/\D/g, '') : null;
    const formattedCEP = cleanCEP && cleanCEP.length === 8 
      ? cleanCEP.replace(/(\d{5})(\d{3})/, '$1-$2') 
      : (body.cep || null);

    // Create colaborador usando função RPC
    const colaboradorData = {
      user_id: newUser.id,
      nome,
      email,
      cpf: cpfClean,
      data_nascimento: data_nascimento || null,
      categoria,
      oab: categoria === "advogado" ? oab : null,
      whatsapp: whatsapp || null,
      cep: formattedCEP,
      rua: rua || null,
      numero: numero || null,
      complemento: complemento || null,
      cidade: cidade || null,
      estado: estado || null,
      cargo_id,
      area_id: area_id || null,
      adicional: adicional || null,
      percentual_adicional: percentual_adicional || null,
      salario: salario || null,
      conta_contabil: body.conta_contabil || null,
      skills: Array.isArray(body.skills) ? body.skills : [],
      banco: banco || null,
      agencia: agencia || null,
      conta_com_digito: conta_com_digito || null,
      chave_pix: chave_pix || null,
    };

    const { data: colaborador, error: createColabError } = await supabase
      .rpc('create_colaborador', {
        p_user_id: user.id,
        p_colaborador_data: colaboradorData
      });

    if (createColabError || !colaborador) {
      // Rollback: delete user if colaborador creation fails usando API REST
      try {
        await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${newUser.id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'apikey': supabaseServiceKey,
            },
          }
        );
      } catch (deleteError) {
        console.error("Error deleting user on rollback:", deleteError);
      }
      
      return new Response(
        JSON.stringify({ 
          error: createColabError?.message || "Failed to create colaborador",
          details: createColabError?.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const colaboradorId = colaborador.id;

    if (Array.isArray(body.skills)) {
      const { error: upsertSkillsError } = await supabase
        .rpc('upsert_colaborador_skills_catalog', {
          p_user_id: user.id,
          p_skills: body.skills,
        });

      if (upsertSkillsError) {
        console.error("Error upserting skills catalog:", upsertSkillsError);
      }
    }

    // Create tenant_user usando RPC
    const { error: tenantUserError } = await supabase
      .rpc('create_tenant_user', {
        p_user_id: user.id,
        p_new_user_id: newUser.id,
        p_status: 'ativo'
      });

    if (tenantUserError) {
      console.error("Error creating tenant_user:", tenantUserError);
      // Não falhar se já existir
    }

    // Assign roles usando função RPC
    if (role_ids && role_ids.length > 0) {
      const { error: updateRolesError } = await supabase
        .rpc('update_user_roles', {
          p_user_id: user.id,
          p_colaborador_user_id: newUser.id,
          p_tenant_id: tenantUser.tenant_id,
          p_role_ids: role_ids
        });

      if (updateRolesError) {
        console.error("Error assigning roles:", updateRolesError);
      }
    }

    // Create beneficios usando função RPC
    if (beneficios && beneficios.length > 0) {
      const { error: updateBeneficiosError } = await supabase
        .rpc('update_colaborador_beneficios', {
          p_colaborador_id: colaboradorId,
          p_beneficios: beneficios
        });

      if (updateBeneficiosError) {
        console.error("Error creating beneficios:", updateBeneficiosError);
      }
    }

    // Create audit log usando função RPC
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                      req.headers.get('x-real-ip') || 
                      null;
    const userAgent = req.headers.get('user-agent') || null;

    try {
      await supabase.rpc('create_audit_log', {
        p_tenant_id: tenantUser.tenant_id,
        p_tipo_entidade: 'people.colaboradores',
        p_entidade_id: colaboradorId,
        p_acao: 'create',
        p_user_id: user.id,
        p_dados_anteriores: null,
        p_dados_novos: colaborador,
        p_ip_address: ipAddress,
        p_user_agent: userAgent,
      });
    } catch (auditError) {
      console.error('Error creating audit log:', auditError);
      // Não falhar a operação principal se audit log falhar
    }

    // Send email with password via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "VLMA <no-reply@erp.vlma.com.br>",
            to: [email],
            subject: "Bem-vindo ao ERP-VLMA",
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h1 style="color: #2563eb;">Bem-vindo ao ERP-VLMA!</h1>
                  <p>Olá <strong>${nome}</strong>,</p>
                  <p>Sua conta foi criada com sucesso no sistema ERP-VLMA.</p>
                  <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p style="margin: 0;"><strong>E-mail:</strong> ${email}</p>
                    <p style="margin: 5px 0 0 0;"><strong>Senha temporária:</strong> ${password}</p>
                  </div>
                  <p>Por favor, faça login e altere sua senha no primeiro acesso.</p>
                  <p style="margin-top: 30px;">
                    <a href="${Deno.env.get("NEXT_PUBLIC_APP_URL") || "http://localhost:3000"}/login" 
                       style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                      Acessar Sistema
                    </a>
                  </p>
                  <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">
                    Esta é uma mensagem automática. Por favor, não responda este e-mail.
                  </p>
                </div>
              </body>
              </html>
            `,
          }),
        });

        if (!emailResponse.ok) {
          console.error("Failed to send email:", await emailResponse.text());
        }
      } catch (emailError) {
        console.error("Error sending email:", emailError);
        // Don't fail the request if email fails
      }
    }

    return new Response(
      JSON.stringify({ id: colaboradorId, message: "Colaborador created successfully" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
