"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DateField from "@/app/components/DateField";
import Icon from "@/app/components/Icon";
import { useToast } from "@/app/components/Toast";
import { useDialog } from "@/app/components/Dialog";
import { useBackdropClose, useEscape } from "@/app/components/useEscape";
import {
  MAX_LONG_STAY_RULES,
  MAX_PROMOTIONS,
  MAX_ROOM_PHOTOS,
  longStayProblem,
  promotionProblem,
  promotionWhen,
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
 * for all of them, always in the header, as every setup page has. A row
 * removed stays on screen, struck through, with Put back, until Save. Photos
 * are the exception: they go up as soon as they are picked.
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

const DATE_LABEL = { stayFrom: "First night", stayTo: "Last night", bookFrom: "Book from", bookTo: "Book to" };

let promoSeq = 0;
const newPromoId = () => `p${Date.now().toString(36)}${(promoSeq += 1)}`;

function shortDay(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Photos go up one at a time, shrunk first so a phone picture uploads quickly. */
async function uploadPhotos(room, files, propertyId, onSaved, onProgress) {
  let left = MAX_ROOM_PHOTOS - room.photos.length;
  const list = [...files].slice(0, Math.max(0, left));
  for (let i = 0; i < list.length; i += 1) {
    onProgress?.(i + 1, list.length);
    const form = new FormData();
    form.append("file", await shrink(list[i]));
    form.append("roomTypeId", room.id);
    if (propertyId) form.append("propertyId", propertyId);
    const res = await fetch("/api/setup/bookingEngine/photo", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "The photo did not save.");
    onSaved(json);
    left -= 1;
  }
  if (files.length > list.length) throw new Error(`A room can have up to ${MAX_ROOM_PHOTOS} photos.`);
}

/** A date cell that can be emptied again, since blank means any date. */
function DateCell({ grid, row, field, invalid }) {
  const value = grid.value(row, field) || "";
  return (
    <span className="inline-flex items-center gap-1">
      <DateField
        className={cellClass(grid.edited(row, field), invalid)}
        style={{ width: "7.5rem" }}
        value={value}
        onChange={(e) => grid.change(row, field, e.target.value)}
        placeholder="Any"
        aria-label={DATE_LABEL[field]}
      />
      {value && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "0.35rem" }}
          onClick={() => grid.change(row, field, "")}
          aria-label={`Clear ${DATE_LABEL[field]}`}
          title="Any date"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  );
}

/** Remove, or Put back for a row waiting to be removed on Save. */
function RemoveButton({ gone, label, onRemove, onRestore }) {
  return gone ? (
    <button type="button" className="btn btn-ghost text-xs" onClick={onRestore}>
      Put back
    </button>
  ) : (
    <button type="button" className="btn btn-ghost text-xs" aria-label={`Remove ${label}`} onClick={onRemove}>
      <Icon name="trash" />
    </button>
  );
}

export default function BookingEngine({ session }) {
  const propertyId = session?.propertyId;
  const scope = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState("link");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [photosFor, setPhotosFor] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [removed, setRemoved] = useState({ promotions: new Set(), longStays: new Set() });
  const [open, setOpen] = useState(new Set());
  const pickerRef = useRef(null);
  const pickFor = useRef(null);
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
          meals: p.meals,
          refundable: p.refundable,
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
    setError(null);
  }

  const toggle = (kind, id, on) =>
    setRemoved((r) => {
      const next = new Set(r[kind]);
      if (on) next.add(id);
      else next.delete(id);
      return { ...r, [kind]: next };
    });

  function remove(kind, grid, row) {
    if (isDraft(row.id)) grid.removeDraft(row.id);
    else toggle(kind, row.id, true);
  }

  const switchTab = (id) => {
    setTab(id);
    setError(null);
  };

  /** An edit clears the message pointing at the cell it fixes. */
  const changed = (grid) => (row, field, v) => {
    if (error?.rowId === row.id) setError(null);
    grid.change(row, field, v);
  };

  async function save() {
    setError(null);
    const promoList = promoRows.filter((r) => !removed.promotions.has(r.id)).concat(promos.drafts).map(promos.merged);
    for (const p of promoList) {
      const problem = promotionProblem(p);
      if (problem) {
        setTab("promotions");
        if (["minNights", "code", "bookTo"].includes(problem.field)) setOpen((o) => new Set([...o, p.id]));
        setError({ rowId: p.id, field: problem.field, message: `${p.name || "New promotion"}: ${problem.message}` });
        return;
      }
    }
    const longList = longRows.filter((r) => !removed.longStays.has(r.id)).concat(longs.drafts).map(longs.merged);
    const longProblem = longStayProblem(longList);
    if (longProblem) {
      setTab("longstays");
      setError({ rowId: longList[longProblem.index].id, field: longProblem.field, message: longProblem.message });
      return;
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
      setError({ message: err.message });
    } finally {
      setBusy(false);
    }
  }

  /** The row's Add photos opens the file picker at once; the panel is for managing photos already up. */
  function photosClicked(room) {
    if (room.photos.length > 0) {
      setPhotosFor(room.id);
      return;
    }
    pickFor.current = room;
    pickerRef.current?.click();
  }

  async function picked(files) {
    const room = pickFor.current;
    if (!room || files.length === 0) return;
    setUploading({ id: room.id, done: 0, of: files.length });
    try {
      await uploadPhotos(room, files, propertyId, (json) => setData((d) => ({ ...d, content: json.content })), (n, of) =>
        setUploading({ id: room.id, done: n, of })
      );
      setPhotosFor(room.id);
    } catch (err) {
      setError({ message: err.message });
    } finally {
      setUploading(null);
      if (pickerRef.current) pickerRef.current.value = "";
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
  const promoList = [...promoRows, ...promos.drafts];
  const longList = [...longRows, ...longs.drafts];
  const photoRoom = photosFor && roomRows.find((r) => r.id === photosFor);
  const bad = (row, field) => error?.rowId === row.id && error?.field === field;
  const promoInput = (row, field, props = {}) =>
    promos.input(row, field, { ...props, invalid: bad(row, field), onChange: (e) => changed(promos)(row, field, e.target.value) });
  const longInput = (row, field, props = {}) =>
    longs.input(row, field, { ...props, invalid: bad(row, field), onChange: (e) => changed(longs)(row, field, e.target.value) });

  const addButton =
    tab === "promotions" ? (
      <button
        type="button"
        className="btn btn-secondary text-sm"
        disabled={promoList.length >= MAX_PROMOTIONS}
        onClick={() =>
          promos.add({ name: "", percent: "", stayFrom: "", stayTo: "", bookFrom: "", bookTo: "", minNights: "", code: "", planId: "", active: true })
        }
      >
        <Icon name="plus" /> Add promotion
      </button>
    ) : tab === "longstays" ? (
      <button
        type="button"
        className="btn btn-secondary text-sm"
        disabled={longList.length >= MAX_LONG_STAY_RULES}
        onClick={() => longs.add({ nights: "", percent: "" })}
      >
        <Icon name="plus" /> Add step
      </button>
    ) : null;

  return (
    <div className="space-y-3">
      <SetupHeader area="Rates" title="Booking Engine" sub="Your own booking page: your rooms, rates, photos and offers. Guests pay straight to you.">
        {url && data.prefs?.enabled && (
          <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">
            Open booking page
          </a>
        )}
        {(tab !== "link" || pending > 0) && <SaveActions count={pending} busy={busy} onSave={save} onDiscard={discard} />}
      </SetupHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="max-w-full overflow-x-auto">
          <div className="seg" role="tablist" aria-label="Booking engine" style={{ whiteSpace: "nowrap" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "seg-on" : ""}
                onClick={() => switchTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {addButton}
      </div>

      {tab === "link" && pending > 0 && (
        <p className="sub">
          {pending} unsaved change{pending === 1 ? "" : "s"} on the other tabs. Save them with the button at the top.
        </p>
      )}
      <Messages error={error?.message} />

      <BookingEngineSettings
        hidden={tab !== "link"}
        propertyId={propertyId}
        initial={data}
        canChange={data.canChangePayment}
        onSaved={(json) => setData((d) => ({ ...d, prefs: json.prefs, key: json.key }))}
      />

      <input
        ref={pickerRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => picked([...e.target.files])}
      />

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
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={Boolean(uploading)}
                      onClick={() => photosClicked(r)}
                    >
                      {uploading?.id === r.id
                        ? `Uploading ${uploading.done} of ${uploading.of}...`
                        : r.photos.length
                          ? `${r.photos.length} photo${r.photos.length === 1 ? "" : "s"}`
                          : "Add photos"}
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
                  <td>{plans.input(p, "description", { placeholder: p.meals || "", maxLength: 300 })}</td>
                  <td>
                    {plans.input(p, "cancellation", {
                      placeholder: p.refundable ? "" : "Non-refundable",
                      maxLength: 300,
                    })}
                  </td>
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
          <p className="sub">
            Percent off the room before tax. The whole stay must fall between the first and last night. The biggest offer
            wins; offers never add up.
          </p>
          <Grid>
            <thead>
              <tr>
                <th>On</th>
                <th style={{ minWidth: 160 }}>Name guests see</th>
                <th>% off</th>
                <th>First night</th>
                <th>Last night</th>
                <th style={{ minWidth: 160 }}>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {promoList.map((p) => {
                const gone = removed.promotions.has(p.id);
                const row = promos.merged(p);
                const when = promotionWhen(row, shortDay);
                const extras = [
                  row.minNights && `${row.minNights}+ nights`,
                  row.code && `Code ${String(row.code).toUpperCase()}`,
                  row.planId && planOptions.find((o) => o.id === row.planId)?.label,
                ].filter(Boolean);
                const expanded = open.has(p.id);
                return [
                  <tr key={p.id} style={gone ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                    <td className="text-center">{promos.check(p, "active", { "aria-label": "Promotion on", disabled: gone })}</td>
                    <td>{promoInput(p, "name", { placeholder: "Diwali offer", maxLength: 60, autoFocus: isDraft(p.id), disabled: gone })}</td>
                    <td>{promoInput(p, "percent", { inputMode: "decimal", style: { width: "4.5rem" }, disabled: gone })}</td>
                    <td>{!gone && <DateCell grid={promos} row={p} field="stayFrom" invalid={bad(p, "stayFrom")} />}</td>
                    <td>{!gone && <DateCell grid={promos} row={p} field="stayTo" invalid={bad(p, "stayTo")} />}</td>
                    <td className="text-xs">
                      <span style={{ color: when.open ? "var(--warn)" : "var(--text-muted)" }}>{when.text}</span>
                      {extras.length > 0 && <span style={{ color: "var(--text-muted)" }}>. {extras.join(", ")}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {!gone && (
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          aria-expanded={expanded}
                          onClick={() =>
                            setOpen((o) => {
                              const n = new Set(o);
                              if (n.has(p.id)) n.delete(p.id);
                              else n.add(p.id);
                              return n;
                            })
                          }
                        >
                          {expanded ? "Less" : "More"}
                        </button>
                      )}
                      <RemoveButton
                        gone={gone}
                        label={row.name || "promotion"}
                        onRemove={() => remove("promotions", promos, p)}
                        onRestore={() => toggle("promotions", p.id, false)}
                      />
                    </td>
                  </tr>,
                  expanded && !gone && (
                    <tr key={`${p.id}-more`}>
                      <td />
                      <td colSpan={6}>
                        <div className="flex flex-wrap items-end gap-3 py-1 text-xs">
                          <label className="space-y-1">
                            <span className="label">Book from</span>
                            <DateCell grid={promos} row={p} field="bookFrom" invalid={bad(p, "bookFrom")} />
                          </label>
                          <label className="space-y-1">
                            <span className="label">Book to</span>
                            <DateCell grid={promos} row={p} field="bookTo" invalid={bad(p, "bookTo")} />
                          </label>
                          <label className="space-y-1">
                            <span className="label">Min stay</span>
                            {promoInput(p, "minNights", { inputMode: "numeric", placeholder: "Any", style: { width: "4.5rem" } })}
                          </label>
                          <label className="space-y-1">
                            <span className="label">Promo code</span>
                            {promoInput(p, "code", { placeholder: "None, open to all", maxLength: 20, style: { width: "9rem", textTransform: "uppercase" } })}
                          </label>
                          <label className="space-y-1" style={{ minWidth: 150 }}>
                            <span className="label">Plan</span>
                            {promos.select(p, "planId", planOptions)}
                          </label>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
              {promoList.length === 0 && (
                <tr>
                  <td colSpan={7} className="sub">
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
          <p className="sub">Off the room before tax. The guest gets the highest step reached, or a promotion if bigger.</p>
          <div className="w-fit max-w-full">
            <Grid>
              <thead>
                <tr>
                  <th>Nights or more</th>
                  <th>% off</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {longList.map((r) => {
                  const gone = removed.longStays.has(r.id);
                  return (
                    <tr key={r.id} style={gone ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                      <td>{longInput(r, "nights", { inputMode: "numeric", placeholder: "3", style: { width: "4.5rem" }, autoFocus: isDraft(r.id), disabled: gone })}</td>
                      <td>{longInput(r, "percent", { inputMode: "decimal", placeholder: "10", style: { width: "4.5rem" }, disabled: gone })}</td>
                      <td>
                        <RemoveButton
                          gone={gone}
                          label="step"
                          onRemove={() => remove("longStays", longs, r)}
                          onRestore={() => toggle("longStays", r.id, false)}
                        />
                      </td>
                    </tr>
                  );
                })}
                {longList.length === 0 && (
                  <tr>
                    <td colSpan={3} className="sub">
                      None yet. For example: 3 nights or more, 10% off.
                    </td>
                  </tr>
                )}
              </tbody>
            </Grid>
          </div>
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
 * A room's photos, in a side panel: add more, make one the cover (the first
 * is the one guests see first), remove one. Each change saves at once.
 */
function RoomPhotos({ room, propertyId, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const addRef = useRef(null);
  const dialog = useDialog();
  const toast = useToast();
  useEscape(() => !busy && onClose());
  const backdrop = useBackdropClose(() => !busy && onClose());
  useEffect(() => addRef.current?.focus(), []);

  async function upload(files) {
    setError("");
    setBusy(true);
    try {
      await uploadPhotos(room, files, propertyId, onSaved, (n, of) => setProgress(`Uploading ${n} of ${of}...`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress(null);
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
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>Photos of {room.name}</h3>
          <button type="button" className="head-close" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="card-pad space-y-3">
          <p className="sub text-xs">
            {room.photos.length} of {MAX_ROOM_PHOTOS}. Photos save straight away. The first is the one guests see first.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => upload([...e.target.files])}
          />
          <button
            ref={addRef}
            type="button"
            className="btn btn-primary"
            disabled={busy || room.photos.length >= MAX_ROOM_PHOTOS}
            onClick={() => fileRef.current?.click()}
          >
            {progress || (busy ? "Saving..." : "Add photos")}
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
