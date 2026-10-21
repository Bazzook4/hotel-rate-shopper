"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../../components/Dialog";
import Hint from "../../components/Hint";

/**
 * The hotel's name and logo as guests see them, for Property Setup.
 *
 * Shown at the top of the guest's online check-in page. The name is the one
 * invoices print too. A logo bigger than the limit is scaled down here on
 * the device, keeping a transparent background transparent.
 */

const MAX_BYTES = 1024 * 1024;
const LONG_SIDE = 600;
const ACCEPT = "image/png,image/jpeg,image/webp";

/** A logo small enough to send, or the file as it is if it already is. */
async function fitLogo(file) {
  if (file.size <= MAX_BYTES) return file;
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
    // A browser that cannot write WebP hands back a PNG, which also keeps transparency.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob) return file;
    const ext = blob.type === "image/webp" ? "webp" : "png";
    return new File([blob], `logo.${ext}`, { type: blob.type });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function HotelBrand({ propertyId, onSaved }) {
  const dialog = useDialog();
  const fileRef = useRef(null);
  const [brand, setBrand] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  // Each message sits beside the control it is about: { at: "logo" | "name", ok, text }.
  const [message, setMessage] = useState(null);
  const [broken, setBroken] = useState(false);
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";

  const load = useCallback(() => {
    let cancelled = false;
    setBrand(null);
    setLoadError("");
    setMessage(null);
    fetch(`/api/setup/brand${scope}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not load the hotel name and logo.");
        if (cancelled) return;
        setBrand(json);
        setName(json.name || "");
        setBroken(false);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(load, [load]);

  async function call(at, url, options, done) {
    setBusy(at);
    setMessage(null);
    try {
      const res = await fetch(url, options);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "That did not save. Please try again.");
      done(json);
    } catch (err) {
      setMessage({ at, ok: false, text: err.message });
    } finally {
      setBusy("");
    }
  }

  function saveName(e) {
    e.preventDefault();
    if (!name.trim()) {
      setMessage({ at: "name", ok: false, text: "Enter the hotel name." });
      return;
    }
    call(
      "name",
      "/api/setup/brand",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propertyId || undefined, name }),
      },
      (json) => {
        setBrand((b) => ({ ...b, name: json.name }));
        setName(json.name);
        setMessage({ at: "name", ok: true, text: "Saved." });
        onSaved?.({ name: json.name });
      }
    );
  }

  async function pick(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    if (!ACCEPT.split(",").includes(picked.type)) {
      setMessage({ at: "logo", ok: false, text: "The logo must be a PNG, JPG or WebP picture." });
      return;
    }
    // Shrinking a camera photo takes a moment on a phone; show it is under way.
    setBusy("logo");
    setMessage(null);
    const form = new FormData();
    form.append("file", await fitLogo(picked));
    if (propertyId) form.append("propertyId", propertyId);
    call("logo", "/api/setup/brand", { method: "POST", body: form }, (json) => {
      setBrand((b) => ({ ...b, logoUrl: json.logoUrl }));
      setBroken(false);
      setMessage({ at: "logo", ok: true, text: "Logo saved." });
    });
  }

  async function removeLogo() {
    const ok = await dialog.confirm({
      title: "Remove the logo?",
      message: "Guests will see only the hotel name. To show a logo again, upload it again.",
      confirmLabel: "Remove logo",
      danger: true,
    });
    if (!ok) return;
    call("logo", `/api/setup/brand${scope}`, { method: "DELETE" }, () => {
      setBrand((b) => ({ ...b, logoUrl: null }));
      setMessage({ at: "logo", ok: true, text: "Logo removed." });
    });
  }

  const note = (at) =>
    message?.at === at && (
      <span className="block text-xs" style={{ color: message.ok ? "var(--accent-text)" : "var(--danger)" }}>
        {message.text}
      </span>
    );

  if (!brand) {
    return (
      <div className="card card-pad">
        {loadError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {loadError}
            </p>
            <button type="button" className="btn btn-secondary text-sm" onClick={() => load()}>
              Try again
            </button>
          </div>
        ) : (
          <p className="sub">Loading...</p>
        )}
      </div>
    );
  }

  const changed = name.trim() !== (brand.name || "");

  return (
    <div className="card card-pad space-y-3">
      <div>
        <h3 className="h2">Hotel name & logo</h3>
        <p className="sub">Shown on the guest check-in page and on invoices.</p>
      </div>
      <Hint id="hotel-brand">
        The name is also how Rate Parity and Competitor Shopper recognise your own hotel, so keep it close to your
        Google listing name.
      </Hint>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex items-start gap-3">
          <div
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg text-center"
            style={{ width: 56, height: 56, border: "1px solid var(--border)", background: "var(--surface-2)" }}
          >
            {brand.logoUrl && !broken ? (
              <img
                src={brand.logoUrl}
                alt={`${brand.name} logo`}
                onError={() => setBroken(true)}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <span className="faint text-xs" title="PNG, JPG or WebP">
                {brand.logoUrl ? "Can't show" : "No logo"}
              </span>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={pick} />
              <button
                type="button"
                className="btn btn-secondary text-sm"
                disabled={Boolean(busy)}
                onClick={() => fileRef.current?.click()}
              >
                {busy === "logo" ? "Uploading..." : brand.logoUrl ? "Change logo" : "Upload logo"}
              </button>
              {brand.logoUrl && (
                <button type="button" className="btn btn-ghost text-sm" disabled={Boolean(busy)} onClick={removeLogo}>
                  Remove
                </button>
              )}
            </div>
            {message?.at === "logo"
              ? note("logo")
              : broken && (
                  <span className="block text-xs" style={{ color: "var(--danger)" }}>
                    The logo could not be shown. Upload it again.
                  </span>
                )}
          </div>
        </div>

        <form onSubmit={saveName} className="min-w-0 flex-1" style={{ minWidth: 240 }}>
          <label className="label" htmlFor={`hotel-name-${propertyId || "own"}`}>
            Hotel name
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`hotel-name-${propertyId || "own"}`}
              className="input min-w-0 flex-1"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (message?.at === "name") setMessage(null);
              }}
              maxLength={120}
              aria-required="true"
              placeholder="e.g. Sea Breeze Resort"
            />
            <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !changed}>
              {busy === "name" ? "Saving..." : "Save"}
            </button>
          </div>
          {note("name")}
        </form>
      </div>
    </div>
  );
}
