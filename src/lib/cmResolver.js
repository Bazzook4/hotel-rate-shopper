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

  return {
    client,
    partner,
    integration,
    propertyId: resolvedPropertyId,
    ready: client.isConfigured() && integration?.enabled !== false,
  };
}
