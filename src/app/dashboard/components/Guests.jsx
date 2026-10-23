"use client";

import Icon from "../../components/Icon";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Grid,
  Messages,
  SaveActions,
  SetupHeader,
  Toolbar,
  isDraft,
  sendJSON,
  useGrid,
} from "./SetupGrid";
import { useSort, SortTh } from "./useSort";
import { useBookingOpener } from "./reportKit";
import { useDialog } from "../../components/Dialog";
import { countryOptions, toCountryCode } from "@/lib/countries";
import { TierBadge, TiersGrid, WalletPlansGrid, useGuestTiers } from "./GuestSettings";
import WalletPanel, { inr, useWalletPlans } from "./WalletPanel";
import GuestIdPhotos from "./GuestIdPhotos";
import { formatAmount } from "@/lib/money";

/**
 * Guests: everyone who has stayed, or is booked to stay, at the property.
 *
 * A booking puts its guest on this list by itself -- matched on phone, then
 * email, or added new -- so the list fills without anyone keeping it. This
 * page is for correcting a record, adding what a booking does not ask for (an
 * ID and a photo of it, a company, an address), and seeing someone's history.
 *
 * Edited like every setup grid: changes are held and highlighted until Save.
 * The search runs on the server, since a busy hotel has more guests than one
 * page should load.
 */

const ID_TYPES = [
  { id: "", label: "-" },
  { id: "aadhaar", label: "Aadhaar" },
  { id: "passport", label: "Passport" },
  { id: "driving_licence", label: "Driving licence" },
  { id: "voter_id", label: "Voter ID" },
  { id: "other", label: "Other" },
];

const STATUS_LABELS = {
  inquiry: "Inquiry",
  confirmed: "Confirmed",
  in_house: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

const money = (v) => formatAmount(v);

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A guest's bookings, opened under their row. */
function GuestHistory({ propertyId, guestId, onOpen, colSpan }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams({ id: guestId });
    if (propertyId) qs.set("propertyId", propertyId);
    fetch(`/api/pms/guests?${qs}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!live) return;
        setState(ok ? { reservations: d.reservations || [] } : { error: d.error || "Could not load stays" });
      })
      .catch(() => live && setState({ error: "Could not load stays" }));
    return () => {
      live = false;
    };
  }, [propertyId, guestId]);

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: "var(--surface-2)", padding: "0.5rem 0.75rem" }}>
        {state.loading && <span className="sub">Loading stays...</span>}
        {state.error && <span style={{ color: "var(--danger)" }}>{state.error}</span>}
        {state.reservations?.length === 0 && <span className="sub">No bookings on record.</span>}
        {state.reservations?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {state.reservations.map((r) => (
              <button
                key={r.id}
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => onOpen(r.id)}
                title="Open this booking"
              >
                {r.reference}, {formatDate(r.check_in)} to {formatDate(r.check_out)}
                {r.room_types?.room_type_name ? `, ${r.room_types.room_type_name}` : ""}
                {r.rooms?.room_number ? ` ${r.rooms.room_number}` : ""},{" "}
                {STATUS_LABELS[r.status] || r.status}
              </button>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function Guests({ session }) {
  const dialog = useDialog();
  const propertyId = session?.propertyId || null;

  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [notReady, setNotReady] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  // One guest's row opened below it: their bookings, their wallet or their ID files.
  const [openId, setOpenId] = useState(null);
  const [openWhat, setOpenWhat] = useState("history");
  // The tiers or wallet plans list, opened above the guests.
  const [settings, setSettings] = useState(null);
  const { tiers, reload: reloadTiers } = useGuestTiers(propertyId);
  const { plans, reload: reloadPlans } = useWalletPlans(propertyId);
  const tierOptions = [{ id: "", label: "-" }, ...tiers.map((t) => ({ id: t.id, label: t.name }))];
  const tierById = Object.fromEntries(tiers.map((t) => [t.id, t]));

  function toggle(g, what) {
    if (openId === g.id && openWhat === what) setOpenId(null);
    else {
      setOpenId(g.id);
      setOpenWhat(what);
    }
  }

  const countries = useMemo(
    () => [{ id: "", label: "-" }, ...countryOptions().map((c) => ({ id: c.code, label: c.name }))],
    []
  );

  // The search waits for a pause in typing, so each keystroke is not a query.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const grid = useGrid(guests);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (propertyId) qs.set("propertyId", propertyId);
      if (query) qs.set("search", query);
      const res = await fetch(`/api/pms/guests?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load guests");
      setGuests(data.guests || []);
      setNotReady(Boolean(data.notReady));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, query]);

  useEffect(() => {
    load();
  }, [load]);

  const { openBooking, modal } = useBookingOpener(session, load);

  const sorter = useSort(guests, {
    name: (g) => String(grid.value(g, "full_name") || "").toLowerCase(),
    stays: "stays",
    nights: "nights",
    revenue: "revenue",
    last: (g) => g.next_stay || g.last_stay,
    wallet: "wallet",
  });
  const rows = [...sorter.rows, ...grid.drafts];

  function addRow() {
    grid.add({
      full_name: "",
      phone: "",
      email: "",
      country: toCountryCode(session?.propertyCountry) || "",
      company: "",
      tier_id: "",
      id_type: "",
      id_number: "",
      notes: "",
    });
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = grid.count;
    const errors = await grid.save({
      label: (g) => g.full_name || "New guest",
      update: (g, changes) => sendJSON("/api/pms/guests", "PATCH", { property_id: propertyId, id: g.id, ...changes }),
      create: (d) => {
        if (!String(d.full_name).trim()) throw new Error("Give the guest a name");
        const { id, ...row } = d;
        // A blank tier is left off, so adding a guest works before tiers exist.
        if (!row.tier_id) delete row.tier_id;
        return sendJSON("/api/pms/guests", "POST", { property_id: propertyId, ...row });
      },
    });
    await load();
    setBusy(false);
    if (errors.length) setError(errors.join(". "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  async function removeGuest(g) {
    if (isDraft(g.id)) {
      grid.removeDraft(g.id);
      return;
    }
    const ok = await dialog.confirm({
      title: `Delete ${g.full_name}?`,
      message: g.stays
        ? `Their ${g.stays} booking${g.stays === 1 ? " stays" : "s stay"} as they are, but will no longer be linked to a guest record.`
        : "This guest has no bookings.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      const qs = propertyId ? `&propertyId=${propertyId}` : "";
      await sendJSON(`/api/pms/guests?id=${g.id}${qs}`, "DELETE");
      setGuests((prev) => prev.filter((x) => x.id !== g.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const COLS = 15;

  return (
    <div className="space-y-4">
      <SetupHeader
        area="Front desk"
        title="Guests"
        count={query ? undefined : guests.length}
        sub="Everyone who has booked. Each new booking adds or finds its guest by phone or email."
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages
        error={error}
        notice={
          notReady
            ? "The guest list is not switched on for this property yet. Bookings still work as before."
            : notice
        }
      />

      <Toolbar>
        <button type="button" className="btn btn-secondary text-sm" onClick={addRow} disabled={notReady}>
          + Add guest
        </button>
        <button
          type="button"
          className={settings === "tiers" ? "btn btn-primary text-sm" : "btn btn-secondary text-sm"}
          onClick={() => setSettings(settings === "tiers" ? null : "tiers")}
          disabled={notReady}
        >
          Tiers{tiers.length ? ` (${tiers.length})` : ""}
        </button>
        <button
          type="button"
          className={settings === "plans" ? "btn btn-primary text-sm" : "btn btn-secondary text-sm"}
          onClick={() => setSettings(settings === "plans" ? null : "plans")}
          disabled={notReady}
        >
          Wallet plans{plans.length ? ` (${plans.length})` : ""}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="input w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone or email..."
          />
        </div>
      </Toolbar>

      {settings === "tiers" && <TiersGrid propertyId={propertyId} tiers={tiers} onSaved={reloadTiers} />}
      {settings === "plans" && <WalletPlansGrid propertyId={propertyId} plans={plans} onSaved={reloadPlans} />}

      <Grid>
        <thead>
          <tr>
            <SortTh sorter={sorter} col="name" className="cm-sticky" style={{ minWidth: 180 }}>
              Name
            </SortTh>
            <th style={{ minWidth: 120 }} title="Set by hand; shown as a badge when the guest books">Tier</th>
            <th style={{ minWidth: 130 }}>Phone</th>
            <th style={{ minWidth: 180 }}>Email</th>
            <th style={{ minWidth: 130 }}>Country</th>
            <th style={{ minWidth: 140 }}>Company</th>
            <th style={{ minWidth: 120 }}>ID type</th>
            <th style={{ minWidth: 130 }}>ID number</th>
            <th style={{ width: 80 }} title="Photos or a PDF of the guest's ID">ID file</th>
            <th style={{ minWidth: 180 }}>Notes</th>
            <SortTh sorter={sorter} col="stays" style={{ width: 70 }}>
              Stays
            </SortTh>
            <SortTh sorter={sorter} col="revenue" style={{ width: 100 }}>
              Spent
            </SortTh>
            <SortTh sorter={sorter} col="last" style={{ width: 120 }}>
              Last / next
            </SortTh>
            <SortTh sorter={sorter} col="wallet" style={{ width: 110 }}>
              Wallet
            </SortTh>
            <th style={{ width: 50 }} />
          </tr>
        </thead>
        <tbody>
          {loading && guests.length === 0 && (
            <tr>
              <td colSpan={COLS} className="cm-empty">
                Loading...
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={COLS} className="cm-empty">
                {query
                  ? "No guest matches that search."
                  : "No guests yet. They are added as bookings are made."}
              </td>
            </tr>
          )}

          {rows.map((g) => {
            const draft = isDraft(g.id);
            const open = openId === g.id && openWhat === "history";
            const walletOpen = openId === g.id && openWhat === "wallet";
            const photosOpen = openId === g.id && openWhat === "photos";
            const photoCount = g.id_photos?.length || 0;
            return (
              <Fragment key={g.id}>
                <tr className={draft ? "cm-new" : undefined}>
                  <td className="cm-sticky">
                    {grid.input(g, "full_name", {
                      placeholder: "Full name",
                      invalid: draft && !String(g.full_name).trim(),
                    })}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {grid.select(g, "tier_id", tierOptions)}
                      {tierById[grid.value(g, "tier_id")] && <TierBadge tier={tierById[grid.value(g, "tier_id")]} />}
                    </div>
                  </td>
                  <td>{grid.input(g, "phone", { type: "tel" })}</td>
                  <td>{grid.input(g, "email", { type: "email" })}</td>
                  <td>
                    {grid.select(
                      g,
                      "country",
                      // A stored country outside the list still shows as itself.
                      grid.value(g, "country") && !countries.some((c) => c.id === grid.value(g, "country"))
                        ? [...countries, { id: grid.value(g, "country"), label: grid.value(g, "country") }]
                        : countries
                    )}
                  </td>
                  <td>{grid.input(g, "company")}</td>
                  <td>{grid.select(g, "id_type", ID_TYPES)}</td>
                  <td>{grid.input(g, "id_number")}</td>
                  <td>
                    {draft ? (
                      "-"
                    ) : (
                      <button
                        type="button"
                        className={photosOpen ? "btn btn-primary text-xs" : "btn btn-ghost text-xs"}
                        onClick={() => toggle(g, "photos")}
                        aria-expanded={photosOpen}
                        title={photoCount ? "See this guest's ID" : "Upload a photo of this guest's ID"}
                      >
                        {photoCount ? `${photoCount} file${photoCount === 1 ? "" : "s"}` : "Add"} {photosOpen ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                  <td>{grid.input(g, "notes", { placeholder: "Preferences, VIP..." })}</td>
                  <td className="cm-num">
                    {draft ? (
                      "-"
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={() => toggle(g, "history")}
                        aria-expanded={open}
                        title="Show this guest's bookings"
                      >
                        {g.stays || 0} {open ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                  <td className="cm-num">{draft ? "-" : money(g.revenue)}</td>
                  <td>
                    {draft ? (
                      "-"
                    ) : g.next_stay ? (
                      <span title="Booked to arrive">Arrives {formatDate(g.next_stay)}</span>
                    ) : (
                      formatDate(g.last_stay)
                    )}
                  </td>
                  <td className="cm-num">
                    {draft ? (
                      "-"
                    ) : (
                      <button
                        type="button"
                        className={walletOpen ? "btn btn-primary text-xs" : "btn btn-ghost text-xs"}
                        onClick={() => toggle(g, "wallet")}
                        aria-expanded={walletOpen}
                        title="Open this guest's wallet"
                      >
                        {g.wallet ? inr(g.wallet) : "Add"} {walletOpen ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => removeGuest(g)}
                      title="Delete guest"
                      aria-label={`Delete ${g.full_name || "guest"}`}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </td>
                </tr>
                {walletOpen && (
                  <tr>
                    <td colSpan={COLS} style={{ background: "var(--surface-2)", padding: "0.5rem 0.75rem" }}>
                      <WalletPanel
                        owner={{ type: "guest", id: g.id, name: g.full_name }}
                        propertyId={propertyId}
                        plans={plans}
                        onChanged={load}
                        onOpenBooking={(id) => openBooking(id)}
                      />
                    </td>
                  </tr>
                )}
                {photosOpen && (
                  <tr>
                    <td colSpan={COLS} style={{ background: "var(--surface-2)", padding: "0.5rem 0.75rem" }}>
                      <GuestIdPhotos propertyId={propertyId} guest={g} onChanged={load} />
                    </td>
                  </tr>
                )}
                {open && (
                  <GuestHistory
                    propertyId={propertyId}
                    guestId={g.id}
                    onOpen={(id) => openBooking(id)}
                    colSpan={COLS}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Grid>

      {modal}
    </div>
  );
}
