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
  if (Object.keys(patch).length === 0) return null;
  const { error } = await supabase.schema("contracts").from("casos").update(patch).eq("id", casoId).eq(
    "tenant_id",
    tenantId,
  );
  return error;
}
