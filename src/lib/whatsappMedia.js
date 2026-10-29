import { getSupabaseAdmin } from "@/lib/database";
import { graph, sendLogged } from "@/lib/whatsapp";

/**
 * Photos, files, voice notes and videos in WhatsApp chats.
 *
 * Meta keeps what a contact sends for about 30 days, behind our token, so
 * each one is copied into a private bucket as it arrives and opened from
 * there through a short-lived link. Photos and PDFs sent from the inbox are
 * kept there too. Where a copy is stored sits on the message's payload as
 * `stored`, so no table change is needed.
 */

const BUCKET = "whatsapp-media";
const LINK_SECONDS = 3600;
const MAX_IN_BYTES = 16 * 1024 * 1024;

export const MEDIA_TYPES = ["image", "sticker", "document", "audio", "video"];
/** What the inbox may send: Meta takes JPEG and PNG as photos, anything else as a file. */
export const SEND_TYPES = { "image/jpeg": "image", "image/png": "image", "application/pdf": "document" };
/** Under Vercel's 4.5 MB request limit; photos are shrunk in the browser first. */
export const MAX_SEND_BYTES = 4 * 1024 * 1024;

const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
};
const extFor = (mime) => EXT[String(mime || "").split(";")[0].trim()] || "bin";

let bucketSeen = false;
async function ensureBucket(db) {
  if (bucketSeen) return;
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not set up WhatsApp file storage: ${error.message}`);
  }
  bucketSeen = true;
}

const auth = () => ({ Authorization: `Bearer ${process.env.WA_TOKEN}` });

/** The photo or file a contact sent, from Meta. */
async function download(mediaId) {
  const meta = await fetch(graph(mediaId), { headers: auth() });
  const info = await meta.json().catch(() => ({}));
  if (!meta.ok || !info.url) throw new Error(info?.error?.message || "WhatsApp no longer has this file");
  if (info.file_size > MAX_IN_BYTES) throw new Error("This file is too big to keep");
  const res = await fetch(info.url, { headers: auth() });
  if (!res.ok) throw new Error(`Could not download the file (${res.status})`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: info.mime_type || res.headers.get("content-type") || "" };
}

/**
 * Copies a received photo or file into storage and notes where on the
 * message. Returns the stored entry, or null if the message has none.
 */
export async function storeIncoming(row) {
  const media = row?.payload?.[row.type];
  if (!MEDIA_TYPES.includes(row?.type) || !media?.id) return null;
  if (row.payload.stored) return row.payload.stored;
  const db = getSupabaseAdmin();
  const { buffer, mime } = await download(media.id);
  await ensureBucket(db);
  const path = `${row.phone}/${row.id}.${extFor(mime)}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
  if (error) throw new Error(`Could not keep the file: ${error.message}`);
  const stored = { path, mime, name: media.filename || null };
  await db.from("wa_messages").update({ payload: { ...row.payload, stored } }).eq("id", row.id);
  return stored;
}

/** A short-lived link to a message's photo or file, copying it from Meta first if it was missed. */
export async function mediaLink(id) {
  const db = getSupabaseAdmin();
  const { data: row } = await db.from("wa_messages").select("id, phone, type, payload").eq("id", id).maybeSingle();
  if (!row) return null;
  const stored = row.payload?.stored || (await storeIncoming(row));
  if (!stored) return null;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(stored.path, LINK_SECONDS);
  if (error) throw new Error(`Could not open the file: ${error.message}`);
  return data.signedUrl;
}

/** Sends a photo or PDF from the inbox, with the typed text as its caption. */
export async function sendMedia(to, { buffer, mime, name }, caption, sentBy) {
  const type = SEND_TYPES[mime];
  if (!type) throw new Error("Send a JPEG or PNG photo, or a PDF.");
  if (buffer.length > MAX_SEND_BYTES) throw new Error("That file is over 4 MB.");

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buffer], { type: mime }), name || `file.${extFor(mime)}`);
  const res = await fetch(graph(`${process.env.WA_PHONE_NUMBER_ID}/media`), { method: "POST", headers: auth(), body: form });
  const up = await res.json().catch(() => ({}));
  if (!res.ok || !up.id) throw new Error(up?.error?.message || `WhatsApp refused the file (${res.status})`);

  const db = getSupabaseAdmin();
  await ensureBucket(db);
  const path = `${to}/out-${crypto.randomUUID()}.${extFor(mime)}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: mime });
  if (error) console.error("WhatsApp file sent but not kept:", error.message);

  const text = String(caption || "").trim().slice(0, 1024);
  const media = { id: up.id, ...(text ? { caption: text } : {}), ...(type === "document" ? { filename: name || "file.pdf" } : {}) };
  const body = type === "image" ? (text ? `Photo: ${text}` : "Photo") : `File: ${name || "PDF"}${text ? `, ${text}` : ""}`;
  return sendLogged(to, type, body, { [type]: media }, sentBy, error ? null : { stored: { path, mime, name: name || null } });
}
