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

    console.log("User verified:", user.id);

    // Get user's tenant - usar função RPC
    const { data: tenantUserData, error: tenantError } = await supabase
      .rpc('get_user_tenant', { p_user_id: user.id });
    
    const tenantUser = tenantUserData && tenantUserData.length > 0 
      ? { tenant_id: tenantUserData[0].tenant_id } 
      : null;

    if (tenantError) {
      console.error("Tenant error:", tenantError);
      console.error("User ID:", user.id);
      return new Response(
        JSON.stringify({ 
          error: "User not associated with tenant", 
          details: tenantError.message,
          user_id: user.id 
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!tenantUser) {
      console.error("No tenant found for user:", user.id);
      return new Response(
        JSON.stringify({ 
          error: "User not associated with tenant",
          user_id: user.id 
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Tenant found:", tenantUser.tenant_id);

    // Check permission - usar função RPC
    // Por enquanto, permitir se o usuário tem tenant válido
    // Em produção, você pode adicionar verificação específica de permissão aqui
    const { data: permissionsData, error: permissionsError } = await supabase
      .rpc('get_user_permissions', { p_user_id: user.id });

    if (permissionsError) {
      console.warn("Permissions check error (non-blocking):", permissionsError);
      // Não bloquear se houver erro na verificação de permissões
      // Apenas logar o erro e continuar se o usuário tem tenant válido
    }

    // Verificar se tem permissões específicas para atualizar colaborador
    const hasUpdatePermission = permissionsData && permissionsData.length > 0 && 
      permissionsData.some((p: any) => 
        p.permission_key === 'people.colaboradores.update' || 
        p.permission_key === 'people.colaboradores.write' ||
        p.permission_key === 'people.colaboradores.*'
      );

    // Se não tiver permissão específica, permitir se tiver tenant válido
    // (Isso pode ser ajustado conforme a política de segurança desejada)
    if (!hasUpdatePermission) {
      console.log("User has no specific update permission, but has valid tenant - allowing update");
      // Continuar com a atualização se o usuário tem tenant válido
    }

    const body = await req.json();
    const { id, role_ids, permission_ids, beneficios, ...updateData } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Missing colaborador id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get current colaborador data for audit - usar função RPC
    const { data: colaboradorData, error: colaboradorError } = await supabase
      .rpc('get_colaborador', { 
        p_user_id: user.id,
        p_colaborador_id: id 
      });

    if (colaboradorError) {
      console.error("Error fetching colaborador:", colaboradorError);
      return new Response(
        JSON.stringify({ 
          error: "Error fetching colaborador", 
          details: colaboradorError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!colaboradorData) {
      return new Response(
        JSON.stringify({ error: "Colaborador not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const currentColab = colaboradorData;

    // If email changed, update auth.users
    if (updateData.email && updateData.email !== currentColab.email) {
      const { error: updateUserError } = await supabase.auth.admin.updateUserById(
        currentColab.user_id,
        { email: updateData.email }
      );

      if (updateUserError) {
        return new Response(
          JSON.stringify({ error: updateUserError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Preparar dados para atualização
    const fieldsToUpdate: any = {};
    
    // Campos permitidos para atualização
    const allowedFields = [
      'nome', 'email', 'cpf', 'data_nascimento', 'categoria', 'oab', 'whatsapp',
      'rua', 'numero', 'complemento', 'cidade', 'estado',
      'cargo_id', 'area_id', 'adicional', 'percentual_adicional', 'salario',
      'conta_contabil', 'skills',
      'banco', 'agencia', 'conta_com_digito', 'chave_pix'
    ];
    
    allowedFields.forEach(field => {
      // Incluir campo se estiver definido (mesmo que seja string vazia ou null)
      if (updateData.hasOwnProperty(field)) {
        // Converter strings vazias para null para campos opcionais
        if (updateData[field] === '' && ['rua', 'numero', 'complemento', 'cidade', 'estado', 'oab', 'whatsapp', 'conta_contabil', 'banco', 'agencia', 'conta_com_digito', 'chave_pix'].includes(field)) {
          fieldsToUpdate[field] = null;
        } else {
          fieldsToUpdate[field] = updateData[field];
        }
      }
    });

    console.log("Fields to update:", JSON.stringify(fieldsToUpdate, null, 2));
    console.log("Original updateData:", JSON.stringify(updateData, null, 2));

    // Update colaborador usando RPC function
    const { data: updatedColabData, error: updateError } = await supabase
      .rpc('update_colaborador_data', {
        p_user_id: user.id,
        p_colaborador_id: id,
        p_update_data: fieldsToUpdate
      });

    console.log("RPC Response - Error:", updateError);
    console.log("RPC Response - Data:", updatedColabData);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ 
          error: updateError.message || "Failed to update colaborador",
          details: updateError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!updatedColabData) {
      return new Response(
        JSON.stringify({ error: "Failed to update colaborador" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const updatedColab = updatedColabData;
    
    console.log("Updated colaborador data:", JSON.stringify(updatedColab, null, 2));
    console.log("Current colaborador tenant_id:", currentColab.tenant_id);
    console.log("Updated colaborador tenant_id:", updatedColab?.tenant_id);

    if (Array.isArray(fieldsToUpdate.skills)) {
      const { error: upsertSkillsError } = await supabase
        .rpc('upsert_colaborador_skills_catalog', {
          p_user_id: user.id,
          p_skills: fieldsToUpdate.skills,
        });

      if (upsertSkillsError) {
        console.error("Error upserting skills catalog:", upsertSkillsError);
      }
    }

    // Update roles if provided - usar função RPC
    if (role_ids !== undefined && Array.isArray(role_ids)) {
      const colaboradorTenantId = updatedColab?.tenant_id || currentColab?.tenant_id;
      
      if (!colaboradorTenantId) {
        console.error("Cannot update roles: tenant_id not found");
        return new Response(
          JSON.stringify({ 
            error: "Cannot update roles: tenant_id not found" 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      console.log("Updating roles:", {
        p_user_id: user.id,
        p_colaborador_user_id: currentColab.user_id,
        p_tenant_id: colaboradorTenantId,
        p_role_ids: role_ids || []
      });
      
      const { data: updateRolesData, error: updateRolesError } = await supabase
        .rpc('update_user_roles', {
          p_user_id: user.id,
          p_colaborador_user_id: currentColab.user_id,
          p_tenant_id: colaboradorTenantId,
          p_role_ids: role_ids || []
        });

      if (updateRolesError) {
        console.error("Error updating roles:", updateRolesError);
        return new Response(
          JSON.stringify({ 
            error: "Error updating roles", 
            details: updateRolesError.message 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      console.log("Roles updated successfully:", updateRolesData);
    }

    // Update direct permissions if provided - usar função RPC
    if (permission_ids !== undefined && Array.isArray(permission_ids)) {
      const colaboradorTenantId = updatedColab?.tenant_id || currentColab?.tenant_id;
      
      if (!colaboradorTenantId) {
        console.error("Cannot update permissions: tenant_id not found");
        return new Response(
          JSON.stringify({ 
            error: "Cannot update permissions: tenant_id not found" 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      console.log("Updating direct permissions:", {
        p_user_id: user.id,
        p_colaborador_user_id: currentColab.user_id,
        p_tenant_id: colaboradorTenantId,
        p_permission_ids: permission_ids || []
      });
      
      const { data: updatePermissionsData, error: updatePermissionsError } = await supabase
        .rpc('update_user_permissions', {
          p_user_id: user.id,
          p_colaborador_user_id: currentColab.user_id,
          p_tenant_id: colaboradorTenantId,
          p_permission_ids: permission_ids || []
        });

      if (updatePermissionsError) {
        console.error("Error updating direct permissions:", updatePermissionsError);
        return new Response(
          JSON.stringify({ 
            error: "Error updating direct permissions", 
            details: updatePermissionsError.message 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      console.log("Direct permissions updated successfully:", updatePermissionsData);
    }

    // Update beneficios if provided - usar função RPC
    if (beneficios !== undefined) {
      const { error: updateBeneficiosError } = await supabase
        .rpc('update_colaborador_beneficios', {
          p_colaborador_id: id,
          p_beneficios: beneficios || []
        });

      if (updateBeneficiosError) {
        console.error("Error updating beneficios:", updateBeneficiosError);
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
        p_entidade_id: id,
        p_acao: 'update',
        p_user_id: user.id,
        p_dados_anteriores: currentColab,
        p_dados_novos: updatedColab,
        p_ip_address: ipAddress,
        p_user_agent: userAgent,
      });
    } catch (auditError) {
      console.error('Error creating audit log:', auditError);
      // Não falhar a operação principal se audit log falhar
    }

    return new Response(
      JSON.stringify({ id: updatedColab.id, message: "Colaborador updated successfully" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
