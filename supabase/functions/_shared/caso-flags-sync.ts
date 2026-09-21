/** RPC create_caso/update_caso não persistem estes flags; sincroniza via service role após a RPC. */
export async function syncCasoPossuiFlags(
  supabase: any,
  tenantId: string,
  casoId: string,
  body: Record<string, unknown>,
) {
  const patch: Record<string, boolean> = {};
  if (typeof body.possui_reajuste === "boolean") patch.possui_reajuste = body.possui_reajuste;
  if (typeof body.possui_cap_horas === "boolean") patch.possui_cap_horas = body.possui_cap_horas;
  // "Enviar relatório de timesheet ao cliente junto com a fatura" (Filipe,
  // 21/09, D15-a): configuração do caso, lida pelo kit e pelo e-mail da fatura.
  if (typeof body.enviar_relatorio_timesheet === "boolean") {
    patch.enviar_relatorio_timesheet = body.enviar_relatorio_timesheet;
  }
  if (Object.keys(patch).length === 0) return null;
  const { error } = await supabase.schema("contracts").from("casos").update(patch).eq("id", casoId).eq(
    "tenant_id",
    tenantId,
  );
  return error;
}
