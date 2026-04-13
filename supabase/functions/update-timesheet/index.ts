import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePeriodoFaturamento(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "operations.timesheet.write" ||
      p.permission_key === "operations.timesheet.*" ||
      p.permission_key === "operations.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para editar timesheet" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    if (!body.id) {
      return new Response(JSON.stringify({ error: "ID do timesheet é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const periodoFaturamento = normalizePeriodoFaturamento(body.periodo_faturamento);
    const bodyKeys = Object.keys(body).filter((key) => body[key] !== undefined);

    if (periodoFaturamento && bodyKeys.every((key) => key === "id" || key === "periodo_faturamento")) {
      const { data: tenantRows, error: tenantError } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
      if (tenantError) {
        return new Response(JSON.stringify({ error: tenantError.message, details: tenantError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tenantId = Array.isArray(tenantRows) && tenantRows.length > 0
        ? tenantRows[0]?.tenant_id as string | undefined
        : undefined;

      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Usuário sem tenant vinculado" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .schema("operations")
        .from("timesheets")
        .update({ periodo_faturamento: periodoFaturamento })
        .eq("id", body.id)
        .eq("tenant_id", tenantId)
        .select("id, periodo_faturamento")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message, details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("update_timesheet", {
      p_user_id: user.id,
      p_timesheet_id: body.id,
      p_payload: body,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
