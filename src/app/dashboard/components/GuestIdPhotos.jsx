"use client";

import { useEffect, useRef, useState } from "react";
import { useDialog } from "../../components/Dialog";
import Icon from "../../components/Icon";

/**
 * A guest's photo ID: the pictures or PDF of the ID they showed at the desk.
 *
 * Opened under the guest's row on the Guests page. On a phone, "Take photo"
 * opens the camera. Photos are shrunk here before they are sent, so a 5 MB
 * phone picture goes up as a few hundred KB and stays readable.
 */

const LONG_SIDE = 2000;

/** A photo as a JPEG no longer than LONG_SIDE; a PDF, or anything the browser cannot draw, as it is. */
export async function shrink(file) {
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function GuestIdPhotos({ propertyId, guest, onChanged }) {
  const dialog = useDialog();
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const qs = (extra) => {
    const p = new URLSearchParams({ guestId: guest.id, ...extra });
    if (propertyId) p.set("propertyId", propertyId);
    return p;
  };

  useEffect(() => {
    let live = true;
    fetch(`/api/pms/guests/photos?${qs()}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!live) return;
        if (ok) setPhotos(d.photos || []);
        else setError(d.error || "Could not load ID files");
      })
      .catch(() => live && setError("Could not load ID files"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, guest.id]);

  async function upload(files) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const original of files) {
        const file = await shrink(original);
        const form = new FormData();
        form.set("guest_id", guest.id);
        if (propertyId) form.set("property_id", propertyId);
        form.set("file", file);
        const res = await fetch("/api/pms/guests/photos", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setPhotos(data.photos || []);
      }
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p) {
    const ok = await dialog.confirm({
      title: "Delete this ID file?",
      message: `${p.name} will be removed from ${guest.full_name}'s record for good.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pms/guests/photos?${qs({ path: p.path })}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete");
      setPhotos(data.photos || []);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const pick = (e) => {
    upload([...(e.target.files || [])]);
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Photo ID</span>
        <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
          Upload
        </button>
        <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => cameraRef.current?.click()}>
          Take photo
        </button>
        <span className="sub text-xs">{busy ? "Working..." : "Photo or PDF, up to 4 MB each. Front and back if the ID has both."}</span>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={pick} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      </div>

      {error && <div className="text-sm" style={{ color: "var(--danger)" }}>{error}</div>}
      {!photos && !error && <span className="sub">Loading...</span>}
      {photos?.length === 0 && <span className="sub">No ID on file.</span>}

      {photos?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.path} className="card" style={{ padding: 6, width: 148 }}>
              <a href={p.url || undefined} target="_blank" rel="noreferrer" title="Open full size">
                {p.type === "application/pdf" ? (
                  <div
                    className="flex items-center justify-center text-sm"
                    style={{ height: 96, background: "var(--surface-2)", borderRadius: 4 }}
                  >
                    PDF
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.url || undefined}
                    alt={p.name}
                    style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 4, display: "block" }}
                  />
                )}
              </a>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs truncate" style={{ flex: 1 }} title={p.name}>
                  {p.name}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  disabled={busy}
                  onClick={() => remove(p)}
                  aria-label={`Delete ${p.name}`}
                  title="Delete"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
