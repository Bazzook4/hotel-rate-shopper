/**
 * Resolve the channel-manager client for a request.
 *
 * Combines the partner credentials (software <-> Aiosell, set by a super
 * admin) with the property's own hotel code, so a caller never needs to know
 * where either half comes from.
 */

import { createAiosellClient } from "@/lib/aiosell";
import {
  getPartnerBySlug,
  getPropertyIntegration,
  getUserPropertyId,
} from "@/lib/database";

export async function resolveChannelManager(session, { propertyId } = {}) {
  const partner = await getPartnerBySlug("aiosell").catch(() => null);

  const resolvedPropertyId =
    propertyId ||
    session?.property_id ||
    (await getUserPropertyId(session?.userId).catch(() => null));

  let hotelCode = null;
  let integration = null;

  if (resolvedPropertyId) {
    const found = await getPropertyIntegration(resolvedPropertyId, "aiosell").catch(
      () => null
    );
    integration = found?.integration || null;
    hotelCode = integration?.hotel_code || null;
  }

  const client = createAiosellClient({ partner, hotelCode });

  const connected = client.isConfigured() && integration?.enabled === true;

  return {
    client,
    partner,
    integration,
    propertyId: resolvedPropertyId,
    ready: connected,

    /**
     * Whether one activity may run. Each is enabled independently, and the
     * partner must support it at all. Direction is from our point of view:
     * rates and inventory go out, reservations come in.
     */
    allows(activity) {
      if (!connected) return false;
      switch (activity) {
        case "rates":
          return integration.rates_out === true && partner?.supports_rates_out !== false;
        case "inventory":
        case "restrictions":
          return (
            integration.inventory_out === true &&
            partner?.supports_inventory_out !== false
          );
        case "reservations":
          return (
            integration.reservations_in === true &&
            partner?.supports_reservations_in !== false
          );
        default:
          return false;
      }
    },
  };
}
