import { getSupabaseAdmin } from '@/lib/database';

/**
 * The hotel's name and logo as guests see them.
 *
 * The name is properties.name, the same one invoices print. The logo's link
 * is kept with the hotel's other look choices in properties.display_prefs
 * (as logoUrl), so it needs no column of its own. The file sits in a public
 * bucket the app makes itself: a logo is meant to be seen, so guests' pages
 * link it directly.
 */

const BUCKET = 'hotel-logos';

export const MAX_LOGO_BYTES = 1024 * 1024;
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export const NEEDS_MIGRATION =
  'The hotel logo needs migration 044_display_prefs.sql. Run it in the Supabase SQL editor, then try again.';

const missingColumn = (error) => /display_prefs/.test(error?.message || '');

let bucketSeen = false;

/** The bucket, made the first time a logo is uploaded. */
async function ensureBucket(supabase) {
  if (bucketSeen) return;
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) {
      console.error('Hotel logo bucket setup failed:', error.message);
      throw new Error('The logo did not save. Please try again.');
    }
  }
  bucketSeen = true;
}

/** Name and logo; a hotel without display choices simply has no logo. */
export async function getHotelBrand(propertyId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('properties').select('*').eq('id', propertyId).maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!data) return null;
  return { name: data.name || '', logoUrl: data.display_prefs?.logoUrl || null };
}

export async function saveHotelName(propertyId, name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('The hotel name cannot be empty.');
  if (clean.length > 120) throw new Error('Keep the hotel name under 120 characters.');
  const { error } = await getSupabaseAdmin()
    .from('properties')
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq('id', propertyId);
  if (error) {
    console.error('Hotel name save failed:', error.message);
    throw new Error('The name did not save. Please try again.');
  }
  return clean;
}

/** The storage path behind one of our own public links, or null. */
function pathOf(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = String(url || '').indexOf(marker);
  return at < 0 ? null : decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
}

async function setLogoUrl(supabase, propertyId, logoUrl) {
  const { data: before, error: readError } = await supabase
    .from('properties')
    .select('display_prefs')
    .eq('id', propertyId)
    .maybeSingle();
  if (readError) throw new Error(missingColumn(readError) ? NEEDS_MIGRATION : readError.message);

  const { error } = await supabase
    .from('properties')
    // Other look choices stored beside it are kept as they are.
    .update({
      display_prefs: { ...(before?.display_prefs || {}), logoUrl },
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId);
  if (error) throw new Error(missingColumn(error) ? NEEDS_MIGRATION : error.message);

  // The old file goes once nothing points at it; a failure only leaves a stray file.
  const old = pathOf(before?.display_prefs?.logoUrl);
  if (old) await supabase.storage.from(BUCKET).remove([old]).catch(() => {});
}

/** Stores a new logo in place of the old one and returns its link. */
export async function saveHotelLogo(propertyId, file) {
  const ext = LOGO_TYPES[file.type];
  if (!ext) throw new Error('The logo must be a PNG, JPG or WebP picture.');
  if (file.size > MAX_LOGO_BYTES) throw new Error('The logo must be 1 MB or smaller.');

  const supabase = getSupabaseAdmin();
  await ensureBucket(supabase);
  const path = `${propertyId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) {
    console.error('Hotel logo upload failed:', error.message);
    throw new Error('The logo did not save. Please try again.');
  }

  const logoUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  try {
    await setLogoUrl(supabase, propertyId, logoUrl);
  } catch (err) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw err;
  }
  return logoUrl;
}

export async function removeHotelLogo(propertyId) {
  await setLogoUrl(getSupabaseAdmin(), propertyId, null);
}
