"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DateField from "@/app/components/DateField";
import Icon from "@/app/components/Icon";
import { useToast } from "@/app/components/Toast";
import { useDialog } from "@/app/components/Dialog";
import { useBackdropClose, useEscape } from "@/app/components/useEscape";
import {
  MAX_DISCOUNT_PERCENT,
  MAX_LONG_STAY_RULES,
  MAX_PROMOTIONS,
  MAX_ROOM_PHOTOS,
  promotionProblem,
} from "@/lib/bookingEngineShared";
import BookingEngineSettings from "./BookingEngineSettings";
import { shrink } from "./GuestIdPhotos";
import { Grid, Loading, Messages, SaveActions, SetupHeader, cellClass, isDraft, sendJSON, useGrid } from "./SetupGrid";

/**
 * The hotel's booking engine, in one place: the page's link and how guests
 * pay, then what guests see -- rooms with photos, plans with what is
 * included and the cancellation terms -- and the discounts: promotions for
 * dates or a promo code, and money off for longer stays.
 *
 * The four content tabs are CM-style grids edited in place, with one Save
 * for all of them, as every setup page has. Photos are the exception: they
 * go up as soon as they are picked, from a side panel per room.
 *
 * Blank text falls back to what Rooms and Rate Plan Setup already say, so a
 * hotel only types what it wants to say differently on its website.
 */

const TABS = [
  { id: "link", label: "Link & payment" },
  { id: "rooms", label: "Rooms" },
  { id: "plans", label: "Plans" },
  { id: "promotions", label: "Promotions" },
  { id: "longstays", label: "Long stays" },
];

let promoSeq = 0;
const newPromoId = () => `p${Date.now().toString(36)}${(promoSeq += 1)}`;

export default function BookingEngine({ session }) {
  const propertyId = session?.propertyId;
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState("link");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photosFor, setPhotosFor] = useState(null);
  const [removed, setRemoved] = useState({ promotions: new Set(), longStays: new Set() });
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError("");
    fetch(`/api/setup/bookingEngine${scope}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Could not load the booking engine.");
        if (!cancelled) setData(json);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [scope, attempt]);

  const content = data?.content;

  // Each grid's stored rows, from the saved content.
  const roomRows = useMemo(
    () =>
      (data?.roomTypes || []).map((t) => {
        const c = content?.rooms?.[t.id] || {};
        return {
          id: t.id,
          name: t.name,
          fallbackDescription: t.description,
          fallbackAmenities: t.amenities.join(", "),
          shown: !c.hidden,
          description: c.description || "",
          amenities: (c.amenities || []).join(", "),
          photos: c.photos || [],
        };
      }),
    [data, content]
  );
  const planRows = useMemo(
    () =>
      (data?.ratePlans || []).map((p) => {
        const c = content?.plans?.[p.id] || {};
        return {
          id: p.id,
          planName: p.name,
          fallbackDescription: p.description,
          shown: !c.hidden,
          name: c.name || "",
          description: c.description || "",
          cancellation: c.cancellation || "",
        };
      }),
    [data, content]
  );
  const promoRows = useMemo(
    () =>
      (content?.promotions || []).map((p) => ({
        ...p,
        percent: p.percent ?? "",
        minNights: p.minNights ?? "",
        stayFrom: p.stayFrom || "",
        stayTo: p.stayTo || "",
        bookFrom: p.bookFrom || "",
        bookTo: p.bookTo || "",
        planId: p.planId || "",
      })),
    [content]
  );
  const longRows = useMemo(
    () => (content?.longStays || []).map((r, i) => ({ id: `ls${i}`, nights: r.nights, percent: r.percent })),
    [content]
  );

  const rooms = useGrid(roomRows);
  const plans = useGrid(planRows);
  const promos = useGrid(promoRows, removed.promotions.size);
  const longs = useGrid(longRows, removed.longStays.size);
  const pending = rooms.count + plans.count + promos.count + longs.count;

  function discard() {
    rooms.discard();
    plans.discard();
    promos.discard();
    longs.discard();
    setRemoved({ promotions: new Set(), longStays: new Set() });
    setError("");
  }

  function remove(kind, grid, row) {
    if (isDraft(row.id)) grid.removeDraft(row.id);
    else setRemoved((r) => ({ ...r, [kind]: new Set([...r[kind], row.id]) }));
  }

  async function save() {
    setError("");
    const promoList = [...promoRows.filter((r) => !removed.promotions.has(r.id)), ...promos.drafts].map(promos.merged);
    for (const p of promoList) {
      const problem = promotionProblem(p);
      if (problem) {
        setTab("promotions");
        setError(`${p.name || "New promotion"}: ${problem}`);
        return;
      }
    }
    const longList = [...longRows.filter((r) => !removed.longStays.has(r.id)), ...longs.drafts].map(longs.merged);
    for (const r of longList) {
      if (!(Number(r.nights) >= 2) || !(Number(r.percent) > 0 && Number(r.percent) <= MAX_DISCOUNT_PERCENT)) {
        setTab("longstays");
        setError(`Each long-stay discount needs 2 or more nights and a discount between 1 and ${MAX_DISCOUNT_PERCENT}%.`);
        return;
      }
    }

    const next = {
      rooms: Object.fromEntries(
        roomRows.map(rooms.merged).map((r) => [
          r.id,
          { hidden: !r.shown, description: r.description, amenities: r.amenities, photos: r.photos },
        ])
      ),
      plans: Object.fromEntries(
        planRows.map(plans.merged).map((p) => [
          p.id,
          { hidden: !p.shown, name: p.name, description: p.description, cancellation: p.cancellation },
        ])
      ),
      promotions: promoList.map((p) => ({ ...p, id: isDraft(p.id) ? newPromoId() : p.id, planId: p.planId || null })),
      longStays: longList.map((r) => ({ nights: Number(r.nights), percent: Number(r.percent) })),
    };

    setBusy(true);
    try {
      const json = await sendJSON("/api/setup/bookingEngine", "PUT", { propertyId: propertyId || undefined, content: next });
      setData((d) => ({ ...d, ...json }));
      discard();
      toast("Booking page saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <SetupHeader area="Rates" title="Booking Engine" />
        <div className="card card-pad flex flex-wrap items-center gap-3">
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {loadError}
          </p>
          <button type="button" className="btn btn-secondary text-sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <Loading label="Loading the booking engine..." />;

  const url = data.key && typeof window !== "undefined" ? `${window.location.origin}/book/${data.key}` : null;
  const planOptions = [{ id: "", label: "All plans" }, ...planRows.map((p) => ({ id: p.id, label: p.planName || "Plan" }))];
  const visiblePromos = [...promoRows.filter((r) => !removed.promotions.has(r.id)), ...promos.drafts];
  const visibleLongs = [...longRows.filter((r) => !removed.longStays.has(r.id)), ...longs.drafts];
  const photoRoom = photosFor && roomRows.find((r) => r.id === photosFor);

  return (
    <div className="space-y-3">
      <SetupHeader
        area="Rates"
        title="Booking Engine"
        sub="Your own booking page: your rooms and rates, your photos, your offers. Guests pay straight to you."
      >
        {url && data.prefs?.enabled && (
          <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">
            Open booking page
          </a>
        )}
        {tab !== "link" && <SaveActions count={pending} busy={busy} onSave={save} onDiscard={discard} />}
      </SetupHeader>

      <div className="seg" role="tablist" aria-label="Booking engine">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "seg-on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Messages error={error} />

      {tab === "link" && (
        <BookingEngineSettings
          propertyId={propertyId}
          canChange={data.canChangePayment}
          onSaved={(json) => setData((d) => ({ ...d, prefs: json.prefs, key: json.key }))}
        />
      )}

      {tab === "rooms" && (
        <>
          <p className="sub">Untick a room to hide it on your website. Blank text uses what Rooms says.</p>
          <Grid>
            <thead>
              <tr>
                <th>Room type</th>
                <th>On website</th>
                <th style={{ minWidth: 280 }}>Description</th>
                <th style={{ minWidth: 220 }}>Amenities, with commas</th>
                <th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {roomRows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-center">{rooms.check(r, "shown", { "aria-label": `Show ${r.name}` })}</td>
                  <td>{rooms.input(r, "description", { placeholder: r.fallbackDescription || "A line about the room", maxLength: 600 })}</td>
                  <td>{rooms.input(r, "amenities", { placeholder: r.fallbackAmenities || "AC, Wi-Fi, TV", maxLength: 400 })}</td>
                  <td>
                    <button type="button" className="btn btn-ghost text-xs" onClick={() => setPhotosFor(r.id)}>
                      {r.photos.length ? `${r.photos.length} photo${r.photos.length === 1 ? "" : "s"}` : "Add photos"}
                    </button>
                  </td>
                </tr>
              ))}
              {roomRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="sub">
                    No room types yet. Add them on Rooms first.
                  </td>
                </tr>
              )}
            </tbody>
          </Grid>
        </>
      )}

      {tab === "plans" && (
        <>
          <p className="sub">Untick a plan to hide it on your website. Blank text uses the plan name and meal plan.</p>
          <Grid>
            <thead>
              <tr>
                <th>Rate plan</th>
                <th>On website</th>
                <th style={{ minWidth: 180 }}>Name guests see</th>
                <th style={{ minWidth: 240 }}>What is included</th>
                <th style={{ minWidth: 260 }}>Cancellation terms</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.planName}</td>
                  <td className="text-center">{plans.check(p, "shown", { "aria-label": `Show ${p.planName}` })}</td>
                  <td>{plans.input(p, "name", { placeholder: p.planName, maxLength: 60 })}</td>
                  <td>{plans.input(p, "description", { placeholder: "Breakfast for two, free Wi-Fi", maxLength: 300 })}</td>
                  <td>{plans.input(p, "cancellation", { placeholder: "Free cancellation up to 2 days before arrival", maxLength: 300 })}</td>
                </tr>
              ))}
              {planRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="sub">
                    No rate plans yet. Add them in Rate Plan Setup first.
                  </td>
                </tr>
              )}
            </tbody>
          </Grid>
        </>
      )}

      {tab === "promotions" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="sub">
              Percent off the room before tax. Blank dates mean any date. With a code, only guests who type it get it. When
              several fit, the guest gets the biggest one; they never add up.
            </p>
            <button
              type="button"
              className="btn btn-secondary text-sm"
              disabled={visiblePromos.length >= MAX_PROMOTIONS}
              onClick={() => promos.add({ name: "", percent: "", stayFrom: "", stayTo: "", bookFrom: "", bookTo: "", minNights: "", code: "", planId: "", active: true })}
            >
              <Icon name="plus" /> Add promotion
            </button>
          </div>
          <Grid>
            <thead>
              <tr>
                <th>On</th>
                <th style={{ minWidth: 160 }}>Name guests see</th>
                <th>% off</th>
                <th>Stay from</th>
                <th>Stay to</th>
                <th>Book from</th>
                <th>Book to</th>
                <th>Min nights</th>
                <th>Promo code</th>
                <th style={{ minWidth: 140 }}>Plan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visiblePromos.map((p) => (
                <tr key={p.id}>
                  <td className="text-center">{promos.check(p, "active", { "aria-label": "Promotion on" })}</td>
                  <td>{promos.input(p, "name", { placeholder: "Monsoon offer", maxLength: 60, autoFocus: isDraft(p.id) })}</td>
                  <td>{promos.input(p, "percent", { inputMode: "decimal", style: { width: "4.5rem" } })}</td>
                  {["stayFrom", "stayTo", "bookFrom", "bookTo"].map((f) => (
                    <td key={f}>
                      <DateField
                        className={cellClass(promos.edited(p, f))}
                        style={{ width: "8.5rem" }}
                        value={promos.value(p, f) || ""}
                        onChange={(e) => promos.change(p, f, e.target.value)}
                        placeholder="Any"
                        aria-label={f}
                      />
                    </td>
                  ))}
                  <td>{promos.input(p, "minNights", { inputMode: "numeric", placeholder: "Any", style: { width: "4.5rem" } })}</td>
                  <td>{promos.input(p, "code", { placeholder: "None", maxLength: 20, style: { width: "7rem", textTransform: "uppercase" } })}</td>
                  <td>{promos.select(p, "planId", planOptions)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      aria-label={`Remove ${promos.value(p, "name") || "promotion"}`}
                      onClick={() => remove("promotions", promos, p)}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
              {visiblePromos.length === 0 && (
                <tr>
                  <td colSpan={11} className="sub">
                    No promotions yet. Add one for a festival, a slow season or a code you share on Instagram.
                  </td>
                </tr>
              )}
            </tbody>
          </Grid>
        </>
      )}

      {tab === "longstays" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="sub">
              Money off for longer stays, on the room before tax. A guest gets the highest step they reach, or a promotion if
              that is bigger.
            </p>
            <button
              type="button"
              className="btn btn-secondary text-sm"
              disabled={visibleLongs.length >= MAX_LONG_STAY_RULES}
              onClick={() => longs.add({ nights: "", percent: "" })}
            >
              <Icon name="plus" /> Add step
            </button>
          </div>
          <Grid>
            <thead>
              <tr>
                <th>Nights or more</th>
                <th>% off</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleLongs.map((r) => (
                <tr key={r.id}>
                  <td>{longs.input(r, "nights", { inputMode: "numeric", placeholder: "3", style: { width: "6rem" }, autoFocus: isDraft(r.id) })}</td>
                  <td>{longs.input(r, "percent", { inputMode: "decimal", placeholder: "10", style: { width: "6rem" } })}</td>
                  <td>
                    <button type="button" className="btn btn-ghost text-xs" aria-label="Remove step" onClick={() => remove("longStays", longs, r)}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
              {visibleLongs.length === 0 && (
                <tr>
                  <td colSpan={3} className="sub">
                    No long-stay discounts. For example: 3 nights or more, 10% off; 7 nights or more, 20% off.
                  </td>
                </tr>
              )}
            </tbody>
          </Grid>
        </>
      )}

      {photoRoom && (
        <RoomPhotos
          room={photoRoom}
          propertyId={propertyId}
          onSaved={(json) => setData((d) => ({ ...d, content: json.content }))}
          onClose={() => setPhotosFor(null)}
        />
      )}
    </div>
  );
}

/**
 * A room's photos, in a side panel. Each goes up as soon as it is picked,
 * shrunk first so a phone picture uploads quickly. The first is the one
 * guests see on the list; Make cover moves another there.
 */
function RoomPhotos({ room, propertyId, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const dialog = useDialog();
  const toast = useToast();
  useEscape(() => !busy && onClose());
  const backdrop = useBackdropClose(() => !busy && onClose());

  async function upload(files) {
    setError("");
    setBusy(true);
    try {
      let left = MAX_ROOM_PHOTOS - room.photos.length;
      for (const original of files) {
        if (left <= 0) {
          setError(`A room can have up to ${MAX_ROOM_PHOTOS} photos.`);
          break;
        }
        const file = await shrink(original);
        const form = new FormData();
        form.append("file", file);
        form.append("roomTypeId", room.id);
        if (propertyId) form.append("propertyId", propertyId);
        const res = await fetch("/api/setup/bookingEngine/photo", { method: "POST", body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "The photo did not save.");
        onSaved(json);
        left -= 1;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function change(url, method) {
    if (method === "DELETE") {
      const yes = await dialog.confirm({
        title: "Remove this photo?",
        message: "Guests will no longer see it on your booking page.",
        confirmLabel: "Remove",
        cancelLabel: "Keep it",
        danger: true,
      });
      if (!yes) return;
    }
    setBusy(true);
    setError("");
    try {
      const json = await sendJSON("/api/setup/bookingEngine/photo", method, {
        propertyId: propertyId || undefined,
        roomTypeId: room.id,
        url,
      });
      onSaved(json);
      toast(method === "DELETE" ? "Photo removed" : "Cover photo changed");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={`Photos of ${room.name}`} {...backdrop}>
      <div className="side-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="side-panel-head card-pad flex items-center justify-between gap-2" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="font-semibold">Photos of {room.name}</div>
            <div className="sub text-xs">
              {room.photos.length} of {MAX_ROOM_PHOTOS}. The first is the one guests see first.
            </div>
          </div>
          <button type="button" className="btn btn-ghost text-sm" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="card-pad space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => upload([...e.target.files])}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || room.photos.length >= MAX_ROOM_PHOTOS}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Uploading..." : "Add photos"}
          </button>
          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          {room.photos.length === 0 && <p className="sub">No photos yet. Rooms with photos get booked more.</p>}
          <div className="grid grid-cols-2 gap-3">
            {room.photos.map((url, i) => (
              <figure key={url} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${room.name} photo ${i + 1}`}
                  className="w-full rounded"
                  style={{ aspectRatio: "4 / 3", objectFit: "cover", border: "1px solid var(--border)" }}
                />
                <figcaption className="flex flex-wrap gap-1">
                  {i === 0 ? (
                    <span className="sub text-xs">Cover</span>
                  ) : (
                    <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => change(url, "PATCH")}>
                      Make cover
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={() => change(url, "DELETE")}>
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
