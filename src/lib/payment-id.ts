const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `paymentId` query value on the checkout return page. PortOne appends its own `paymentId` to our
 * redirectUrl (which already carries one), so the value may arrive twice; it is accepted only when
 * every copy is the same valid id.
 */
export function paymentIdFromQuery(raw: string | string[] | undefined): string | null {
  const values = typeof raw === "string" ? [raw] : (raw ?? []);
  if (values.length === 0) return null;
  const [first] = values;
  return UUID.test(first) && values.every((v) => v === first) ? first : null;
}
