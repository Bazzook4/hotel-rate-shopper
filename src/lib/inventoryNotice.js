/**
 * What the desk is told when a booking saved but the OTAs were not updated.
 *
 * Routes that change what is free answer with `inventory: { status, message }`.
 * Only a failure is worth interrupting anyone for: "not connected" and "not
 * mapped" are how the property is set up, and the activity log records them.
 * Safe to import from client components.
 */
export function inventoryWarning(data) {
  const inv = data?.inventory;
  if (!inv || inv.status !== "failed") return null;
  return `Saved — but the OTAs were not told the new availability (${inv.message}). Resend it from Rates & Inventory → Resync → Availability.`;
}
