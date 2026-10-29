"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Select from "@/app/components/Select";
import Icon from "@/app/components/Icon";
import { useToast } from "@/app/components/Toast";
import { useDialog } from "@/app/components/Dialog";
import { useBackdropClose, useEscape } from "@/app/components/useEscape";
import {
  BANNER,
  HOTEL_AMENITIES,
  timeLabel,
  maxPhotosFor,
} from "@/lib/bookingEngineShared";
import BookingEngineSettings from "./BookingEngineSettings";
import OffersTab from "./BookingOffers";
import { shrink } from "./GuestIdPhotos";
import { Grid, Loading, Messages, SaveActions, SetupHeader, sendJSON, useGrid } from "./SetupGrid";

/**
 * The hotel's booking engine, in one place: the page's link and how guests
 * pay, then what guests see -- rooms with photos, plans with what is
 * included and the cancellation terms -- and every discount on one Offers
 * tab: promotions, long stays and coupon codes (BookingOffers.jsx).
 *
 * Hotel, Rooms and Plans are edited in place, with one Save for all of
 * them, always in the header, as every setup page has. Photos and offers
 * are the exceptions: photos go up as soon as they are picked, and an offer
 * saves from its own panel.
 *
 * Blank text falls back to what Rooms and Rate Plan Setup already say, so a
 * hotel only types what it wants to say differently on its website.
 */

const TABS = [
  { id: "link", label: "Link & payment" },
  { id: "hotel", label: "Hotel" },
  { id: "rooms", label: "Rooms" },
  { id: "plans", label: "Plans" },
  { id: "offers", label: "Offers" },
];

const DATE_LABEL = { stayFrom: "First night", stayTo: "Last night", bookFrom: "Book from", bookTo: "Book to" };

/** Photos go up one at a time, shrunk first so a phone picture uploads quickly. */
async function uploadPhotos(room, files, propertyId, onSaved, onProgress) {
  const max = maxPhotosFor(room.id);
  let left = max - room.photos.length;
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
  if (files.length > list.length) {
    throw new Error(room.id === BANNER ? `The banner can have up to ${max} photos.` : `A room can have up to ${max} photos.`);
  }
}

/**
 * The hotel's booking page link, always at the top: copy it to share, or
 * open it. While the page is closed it says so, since guests opening the
 * link would only be told it is not open.
 */
function LinkBar({ url, open, onTurnOn }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Booking page link copied");
    } catch {
      toast("Could not copy. Select the link and copy it yourself.", { tone: "error" });
    }
  }
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3">
      <span className="label" style={{ margin: 0 }}>
        Your booking page
      </span>
      <input
        className="input min-w-0 flex-1 font-mono text-sm"
        style={{ minWidth: "14rem" }}
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        aria-label="Booking page link"
      />
      <button type="button" className="btn btn-secondary text-sm" onClick={copy}>
        Copy link
      </button>
      <a className="btn btn-secondary text-sm" href={url} target="_blank" rel="noreferrer">
        Open
      </a>
      {open ? (
        <span className="text-xs font-medium" style={{ color: "var(--accent-text)" }}>
          Open to guests
        </span>
      ) : (
        <span className="flex items-center gap-2 text-xs" style={{ color: "var(--warn)" }}>
          Closed to guests until you add how they pay.
          <button type="button" className="btn btn-ghost text-xs" onClick={onTurnOn}>
            Set up payment
          </button>
        </span>
      )}
    </div>
  );
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/**
 * The hotel itself, as guests see it on the booking page: about the hotel,
 * its amenities, when guests arrive and leave, where it is and how to reach
 * it, and the house rules. A blank box uses what Property Setup holds,
 * shown in grey inside it.
 */
function HotelTab({ form, setForm, defaults }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ticked = new Set(form.amenities);
  const others = form.amenities.filter((a) => !HOTEL_AMENITIES.includes(a));
  const usingDefaults = form.amenities.length === 0 && (defaults.amenities || []).length > 0;
  const toggle = (a) =>
    setForm((f) => ({ ...f, amenities: ticked.has(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] }));
  const [othersText, setOthersText] = useState(others.join(", "));
  const setOthers = (value) =>
    setForm((f) => ({
      ...f,
      amenities: [...f.amenities.filter((a) => HOTEL_AMENITIES.includes(a)), ...value.split(",").map((a) => a.trim()).filter(Boolean)],
    }));
  const timeSelect = (k, label) => (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <Select className="input w-full" value={form[k] || ""} onChange={set(k)}>
        <option value="">{defaults[k] ? `As in Property Setup (${timeLabel(defaults[k])})` : "Not shown"}</option>
        {TIMES.map((t) => (
          <option key={t} value={t}>
            {timeLabel(t)}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <div className="space-y-3">
      <p className="sub">What guests read about your hotel on the booking page. Blank boxes use what Property Setup says.</p>
      <section className="card card-pad space-y-3">
        <label className="block space-y-1">
          <span className="label">About the hotel</span>
          <textarea
            className="input w-full"
            rows={4}
            maxLength={1500}
            value={form.about}
            placeholder={defaults.about || "A few lines about your hotel: where it is, what is nearby, what guests love."}
            onChange={set("about")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {timeSelect("checkIn", "Check-in from")}
          {timeSelect("checkOut", "Check-out by")}
          <label className="block space-y-1">
            <span className="label">Phone for guests</span>
            <input className="input w-full" type="tel" value={form.phone} placeholder={defaults.phone || ""} onChange={set("phone")} maxLength={30} />
          </label>
          <label className="block space-y-1">
            <span className="label">Email for guests</span>
            <input className="input w-full" type="email" value={form.email} placeholder={defaults.email || ""} onChange={set("email")} maxLength={120} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">Address</span>
            <input className="input w-full" value={form.address} placeholder={defaults.address || ""} onChange={set("address")} maxLength={300} />
          </label>
          <label className="block space-y-1">
            <span className="label">Google Maps link (optional)</span>
            <input
              className="input w-full"
              value={form.mapUrl}
              placeholder={defaults.mapUrl || "Blank finds you on Maps from the address"}
              onChange={set("mapUrl")}
              spellCheck={false}
            />
          </label>
        </div>
      </section>

      <section className="card card-pad space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="h2">Hotel amenities</h3>
          {usingDefaults && (
            <span className="sub text-xs">Until you tick some, guests see the list in Property Setup: {defaults.amenities.join(", ")}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
          {HOTEL_AMENITIES.map((a) => (
            <label key={a} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={ticked.has(a)} onChange={() => toggle(a)} />
              {a}
            </label>
          ))}
        </div>
        <label className="block space-y-1 pt-1">
          <span className="label">Others, with commas</span>
          <input
            className="input w-full"
            value={othersText}
            placeholder="Rooftop cafe, Bonfire, Temple 2 km"
            onChange={(e) => {
              setOthersText(e.target.value);
              setOthers(e.target.value);
            }}
          />
        </label>
      </section>

      <section className="card card-pad">
        <label className="block space-y-1">
          <span className="label">House rules</span>
          <textarea
            className="input w-full"
            rows={3}
            maxLength={1500}
            value={form.rules}
            placeholder="ID needed for every adult at check-in. No smoking in rooms. Couples welcome."
            onChange={set("rules")}
          />
        </label>
      </section>
    </div>
  );
}

/** Small previews of the first few photos, so a row shows what guests will see. */
function Thumbs({ photos }) {
  if (!photos?.length) return null;
  return (
    <span className="mr-2 inline-flex gap-1 align-middle">
      {photos.slice(0, 3).map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt=""
          width={40}
          height={30}
          className="rounded"
          style={{ width: 40, height: 30, objectFit: "cover", border: "1px solid var(--border)" }}
        />
      ))}
    </span>
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
  const [hotelForm, setHotelForm] = useState(null);
  const [hotelKey, setHotelKey] = useState(0);
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
  // The Hotel tab is one record, so it is a form; it counts as one change.
  const hotelSaved = content?.hotel;
  useEffect(() => setHotelForm(hotelSaved || null), [hotelSaved]);
  const hotelDirty = Boolean(hotelForm && hotelSaved && JSON.stringify(hotelForm) !== JSON.stringify(hotelSaved));

  const rooms = useGrid(roomRows);
  const plans = useGrid(planRows);
  const pending = rooms.count + plans.count + (hotelDirty ? 1 : 0);

  function discard() {
    rooms.discard();
    plans.discard();
    setHotelForm(hotelSaved || null);
    setHotelKey((k) => k + 1);
    setError(null);
  }

  const switchTab = (id) => {
    setTab(id);
    setError(null);
  };

  /** A promotion or coupon saves on its own, from its panel, with the rest of the saved content. */
  async function saveOffers(offers) {
    const json = await sendJSON("/api/setup/bookingEngine", "PUT", {
      propertyId: propertyId || undefined,
      content: { ...content, ...offers },
    });
    setData((d) => ({ ...d, content: json.content }));
  }

  async function save() {
    setError(null);
    const next = {
      ...content,
      hotel: hotelForm || hotelSaved,
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
  const banner = { id: BANNER, name: "the banner", photos: content?.banner || [] };
  const photoRoom = photosFor === BANNER ? banner : photosFor && roomRows.find((r) => r.id === photosFor);
  return (
    <div className="space-y-3">
      <SetupHeader area="Rates" title="Booking Engine" sub="Your own booking page: your rooms, rates, photos and offers. Guests pay straight to you.">
        {(["hotel", "rooms", "plans"].includes(tab) || pending > 0) && <SaveActions count={pending} busy={busy} onSave={save} onDiscard={discard} />}
      </SetupHeader>

      {url && <LinkBar url={url} open={data.prefs?.enabled === true} onTurnOn={() => switchTab("link")} />}

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

      {tab === "hotel" && hotelForm && (
        <HotelTab key={hotelKey} form={hotelForm} setForm={setHotelForm} defaults={data.hotelDefaults || {}} />
      )}

      {tab === "rooms" && (
        <>
          <section className="card flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">Banner</div>
              <p className="sub text-xs">
                Photos of your hotel across the top of your booking page: the building, the view, the pool. Wide photos look
                best.
              </p>
            </div>
            <Thumbs photos={banner.photos} />
            <button type="button" className="btn btn-secondary text-sm" disabled={Boolean(uploading)} onClick={() => photosClicked(banner)}>
              {uploading?.id === BANNER
                ? `Uploading ${uploading.done} of ${uploading.of}...`
                : banner.photos.length
                  ? "Change banner"
                  : "Add banner photos"}
            </button>
          </section>
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
                  <td className="whitespace-nowrap">
                    <Thumbs photos={r.photos} />
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

      {tab === "offers" && (
        <OffersTab
          promotions={content.promotions || []}
          coupons={content.coupons || []}
          rooms={roomRows.map((r) => ({ id: r.id, name: r.name }))}
          plans={planRows.map((p) => ({ id: p.id, name: p.planName }))}
          currency={data.currency}
          usedCounts={data.couponUses || {}}
          onSave={saveOffers}
        />
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
  const max = maxPhotosFor(room.id);
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
          <h3>{room.id === BANNER ? "Banner photos" : `Photos of ${room.name}`}</h3>
          <button type="button" className="head-close" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="card-pad space-y-3">
          <p className="sub text-xs">
            {room.photos.length} of {max}. Photos save straight away. The first is the one guests see first.
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
            disabled={busy || room.photos.length >= max}
            onClick={() => fileRef.current?.click()}
          >
            {progress || (busy ? "Saving..." : "Add photos")}
          </button>
          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          {room.photos.length === 0 && (
            <p className="sub">{room.id === BANNER ? "No banner yet." : "No photos yet. Rooms with photos get booked more."}</p>
          )}
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
