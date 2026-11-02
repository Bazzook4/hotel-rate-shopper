import { cache } from "react";
import { headers } from "next/headers";
import { getSupabaseAdmin, listRoomTypes } from "@/lib/database";
import { cleanBookingContent, cleanBookingPrefs, timeLabel } from "@/lib/bookingEngineShared";
import { hotelDetails } from "@/lib/bookingEngine";
import { APP_URL, isAppHost } from "@/lib/appHost";

export { APP_URL };

/**
 * The hotel's own website, shown at /site/<booking key> or on the hotel's
 * own domain. It reads what the hotel already filled in for its booking
 * page (about, amenities, banner, room descriptions and photos, contact)
 * plus a gallery and a tagline. Nothing here is private: only what the
 * hotel chose to show is returned.
 */

/** The property behind a booking key, or a domain written in its place. Null if unknown or switched off. */
export async function findSite(keyOrHost) {
  const id = String(keyOrHost || "");
  if (!id || id.length > 120) return null;
  const supabase = getSupabaseAdmin();
  let query = supabase.from("properties").select("*");
  if (id.includes(".")) {
    query = query.eq("booking_engine->content->site->>domain", id.toLowerCase().replace(/^www\./, ""));
  } else {
    query = query.eq("booking_key", id);
  }
  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return null;
  const content = cleanBookingContent(data.booking_engine?.content);
  if (!content.site.on) return null;
  // A hotel's own address only answers once we approved it.
  if (id.includes(".") && !content.site.approved) return null;
  return { property: data, content, prefs: cleanBookingPrefs(data.booking_engine) };
}

/** Everything the website's pages show. */
export async function siteView(site) {
  const { property, content, prefs } = site;
  const types = await listRoomTypes(property.id);
  const rooms = types
    .filter((t) => !content.rooms?.[t.id]?.hidden)
    .map((t) => {
      const own = content.rooms?.[t.id] || {};
      const amenities = own.amenities?.length ? own.amenities : Array.isArray(t.amenities) ? t.amenities : [];
      return {
        id: t.id,
        name: t.room_type_name,
        description: own.description || t.description || "",
        amenities,
        photos: own.photos || [],
        guests: t.max_adults || null,
      };
    });
  const details = hotelDetails(property, content);
  const key = property.booking_key;
  const bookUrl = prefs.enabled && key ? `${APP_URL}/book/${key}` : null;
  const photos = [...content.banner, ...content.gallery];
  return {
    key,
    name: property.name || "",
    logoUrl: property.display_prefs?.logoUrl || null,
    tagline: content.site.tagline,
    banner: content.banner,
    gallery: content.gallery.length ? content.gallery : photos,
    details,
    rooms,
    show: content.site.show,
    reach: content.site.reach,
    info: content.site.info.length ? content.site.info : autoInfo(details),
    faqs: content.site.faqs.length ? content.site.faqs : autoFaqs(details, bookUrl),
    mapEmbed: details.address
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${property.name || ""} ${details.address}`)}&output=embed`
      : null,
    // The booking page only takes bookings once the hotel has set up payment.
    bookUrl,
  };
}

/** Hotel information from the Hotel tab, until the hotel types its own rows. */
function autoInfo(d) {
  return [
    d.checkIn && { label: "Check-in", value: `From ${timeLabel(d.checkIn)}` },
    d.checkOut && { label: "Check-out", value: `By ${timeLabel(d.checkOut)}` },
    d.phone && { label: "Phone", value: d.phone },
    d.email && { label: "Email", value: d.email },
    d.rules && { label: "House rules", value: d.rules },
  ].filter(Boolean);
}

/** A few questions every guest asks, answered from the Hotel tab, until the hotel writes its own. */
function autoFaqs(d, bookUrl) {
  return [
    d.checkIn && { q: "What time is check-in?", a: `Check-in is from ${timeLabel(d.checkIn)}.` },
    d.checkOut && { q: "What time is check-out?", a: `Check-out is by ${timeLabel(d.checkOut)}.` },
    d.address && { q: "Where are you?", a: d.address },
    bookUrl && { q: "How do I book?", a: "Press Book now, pick your dates and room, and follow the steps." },
  ].filter(Boolean);
}

/** The site's view for a page, loaded once per request however many parts of the page ask. Null when unknown or closed. */
export const loadSite = cache(async (key) => {
  const site = await findSite(key);
  return site ? siteView(site) : null;
});

/** Where the site's links start: the domain's root on a hotel's own domain, /site/<key> on ours. */
export async function siteBase(key) {
  const host = (await headers()).get("host");
  return isAppHost(host) ? `/site/${key}` : "";
}
