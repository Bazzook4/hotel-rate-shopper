import { getSupabaseAdmin } from '@/lib/database';

/**
 * A guest's photo ID files (migration 051).
 *
 * The files sit in a private bucket and are never linked publicly: whoever
 * may open the Guests page is handed a signed link that runs out after a few
 * minutes. guests.id_photos lists them so the page can count them per row.
 */

const BUCKET = 'guest-ids';
const LINK_SECONDS = 600;

export const MAX_ID_PHOTOS = 6;
export const MAX_ID_PHOTO_BYTES = 4 * 1024 * 1024;
export const ID_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

let bucketSeen = false;

/** The bucket, made here if the SQL that makes it has not been pasted yet. */
export async function ensureBucket(supabase) {
  if (bucketSeen) return;
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Could not set up ID storage: ${error.message}`);
    }
  }
  bucketSeen = true;
}

async function loadPhotos(supabase, propertyId, guestId) {
  const { data, error } = await supabase
    .from('guests')
    .select('id, id_photos')
    .eq('property_id', propertyId)
    .eq('id', guestId)
    .maybeSingle();
  if (error) {
    if (/id_photos/.test(error.message)) {
      throw new Error('ID photos are not switched on for this property yet.');
    }
    throw new Error(`Failed to load guest: ${error.message}`);
  }
  if (!data) return null;
  return Array.isArray(data.id_photos) ? data.id_photos : [];
}

async function savePhotos(supabase, propertyId, guestId, photos) {
  const { error } = await supabase
    .from('guests')
    .update({ id_photos: photos, updated_at: new Date().toISOString() })
    .eq('property_id', propertyId)
    .eq('id', guestId);
  if (error) throw new Error(`Failed to save guest: ${error.message}`);
}

/** A guest's ID files, each with a short-lived link to view it. Null if no such guest. */
export async function listGuestIdPhotos(propertyId, guestId) {
  const supabase = getSupabaseAdmin();
  const photos = await loadPhotos(supabase, propertyId, guestId);
  if (!photos) return null;
  if (photos.length === 0) return [];

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(photos.map((p) => p.path), LINK_SECONDS);
  if (error) throw new Error(`Could not open the ID files: ${error.message}`);
  const urlByPath = new Map((data || []).map((d) => [d.path, d.signedUrl]));
  return photos.map((p) => ({ ...p, url: urlByPath.get(p.path) || null }));
}

/** Stores one file against the guest. Returns the guest's files, or null if no such guest. */
export async function addGuestIdPhoto(propertyId, guestId, file) {
  const supabase = getSupabaseAdmin();
  const photos = await loadPhotos(supabase, propertyId, guestId);
  if (!photos) return null;
  if (photos.length >= MAX_ID_PHOTOS) {
    throw new Error(`A guest can have up to ${MAX_ID_PHOTOS} ID files. Delete one first.`);
  }

  await ensureBucket(supabase);
  const path = `${propertyId}/${guestId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const entry = {
    path,
    name: String(file.name || 'ID').slice(0, 120),
    type: file.type,
    size: file.size,
    uploaded_at: new Date().toISOString(),
  };
  try {
    await savePhotos(supabase, propertyId, guestId, [...photos, entry]);
  } catch (err) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw err;
  }
  return listGuestIdPhotos(propertyId, guestId);
}

/** Deletes one of the guest's files. Returns what is left, or null if no such guest. */
export async function removeGuestIdPhoto(propertyId, guestId, path) {
  const supabase = getSupabaseAdmin();
  const photos = await loadPhotos(supabase, propertyId, guestId);
  if (!photos) return null;
  if (!photos.some((p) => p.path === path)) throw new Error('That file is not on this guest.');

  await savePhotos(supabase, propertyId, guestId, photos.filter((p) => p.path !== path));
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error('Guest ID file left in storage:', path, error.message);
  return listGuestIdPhotos(propertyId, guestId);
}

/** Every ID file a guest has, removed with the guest. Never fatal. */
export async function removeAllGuestIdPhotos(propertyId, guestId) {
  try {
    const supabase = getSupabaseAdmin();
    const folder = `${propertyId}/${guestId}`;
    const { data } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
    if (data?.length) {
      await supabase.storage.from(BUCKET).remove(data.map((f) => `${folder}/${f.name}`));
    }
  } catch (err) {
    console.error('Guest ID files not removed:', guestId, err.message);
  }
}

// ------------------------------------------------------------------
// Files a guest sent through online check-in (migration 053)
// ------------------------------------------------------------------

/**
 * Stores a file a guest uploaded through their check-in link. It is kept
 * apart from the guest records, under <property>/checkin/<link>/, until the
 * desk accepts it. Returns the entry to list on the check-in.
 */
export async function storeCheckinFile(propertyId, checkinId, file) {
  const supabase = getSupabaseAdmin();
  await ensureBucket(supabase);
  const path = `${propertyId}/checkin/${checkinId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return {
    path,
    name: String(file.name || 'ID').slice(0, 120),
    type: file.type,
    size: file.size,
    uploaded_at: new Date().toISOString(),
  };
}

/** Removes stored files. Never fatal: a file left behind is logged. */
export async function removeStoredFiles(paths) {
  if (!paths?.length) return;
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(paths);
  if (error) console.error('ID files left in storage:', paths.length, error.message);
}

/** Short-lived links to view files, by path. */
export async function signedFileLinks(paths) {
  if (!paths?.length) return new Map();
  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrls(paths, LINK_SECONDS);
  if (error) throw new Error(`Could not open the ID files: ${error.message}`);
  return new Map((data || []).map((d) => [d.path, d.signedUrl]));
}

/**
 * Moves files from a check-in into the guest's own ID folder and lists them
 * on the guest. Returns the entries at their new paths. The desk's own limit
 * of MAX_ID_PHOTOS is for uploads at the desk; files the guest sent are all
 * kept.
 */
export async function adoptIdFiles(propertyId, guestId, files) {
  if (!files?.length) return [];
  const supabase = getSupabaseAdmin();
  const photos = (await loadPhotos(supabase, propertyId, guestId)) || [];
  const moved = [];
  for (const f of files) {
    const to = `${propertyId}/${guestId}/${f.path.split('/').pop()}`;
    const { error } = await supabase.storage.from(BUCKET).move(f.path, to);
    if (error) throw new Error(`Could not move an ID file to the guest: ${error.message}`);
    moved.push({ ...f, path: to });
  }
  await savePhotos(supabase, propertyId, guestId, [...photos, ...moved]);
  return moved;
}
