export function onlyDigits(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
}

export function digitsOrNull(value: unknown): string | null {
  const d = onlyDigits(value);
  return d.length ? d : null;
}
