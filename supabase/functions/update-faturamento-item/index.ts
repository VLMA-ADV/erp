import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", {
      p_user_id: user.id,
    });
    const hasPermission = permissionsData?.some(
      (p: { permission_key?: string }) =>
        p.permission_key === "finance.faturamento.review" ||
        p.permission_key === "finance.faturamento.approve" ||
        p.permission_key === "finance.faturamento.manage" ||
        p.permission_key === "finance.faturamento.*" ||
        p.permission_key === "finance.*" ||
        p.permission_key === "*",
    );

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: "Você não tem permissão para alterar item de faturamento" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    const tenantUser = tenantUserData?.length
      ? { tenant_id: tenantUserData[0].tenant_id as string }
      : null;

    if (!tenantUser) {
      return new Response(JSON.stringify({ error: "User not associated with tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const itemId = body.id ?? body.billing_item_id;
    const casoId = body.caso_id;

    if (!itemId || !casoId) {
      return new Response(JSON.stringify({ error: "id e caso_id são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A transferência inteira (item + lançamento de origem + snapshot +
    // auditoria) roda numa transação só, na RPC. Antes esta edge só trocava
    // caso/contrato/cliente do billing_item: o lançamento ficava no caso
    // antigo e a revisão seguinte, sem achá-lo no caso do item, criava um
    // lançamento gêmeo — o mesmo trabalho cobrado duas vezes (caso 1935,
    // Caminhos do Paraná, 09/10). cliente_id continua acompanhando o caso
    // (bug de 11/08, Campo Rico x 7 Holding).
    const { data: moved, error: moveError } = await supabase.rpc("transferir_billing_item_caso", {
      p_user_id: user.id,
      p_item_id: itemId,
      p_caso_id: casoId,
    });

    if (moveError) {
      const msg = moveError.message ?? "Erro ao transferir item";
      const status = /não encontrado/i.test(msg) ? 404 : /permissão/i.test(msg) ? 403 : 400;
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        data: {
          billing_item_id: itemId,
          caso_id: casoId,
          contrato_id: moved?.contrato_id ?? null,
          timesheet_movido: moved?.timesheet_movido ?? false,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
