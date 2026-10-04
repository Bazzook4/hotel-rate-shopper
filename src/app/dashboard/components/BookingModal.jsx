"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BookingForm from "./BookingForm";
import FolioTabs from "./FolioTabs";
import { todayUTC } from "@/lib/date";
import { inventoryWarning } from "@/lib/inventoryNotice";
import { useToast } from "../../components/Toast";
import { useDialog } from "../../components/Dialog";
import { useFrontDesk, whatsappLink } from "./frontDesk";
import { toCountryCode } from "@/lib/countries";

/**
 * One booking, opened from the tape chart or any list.
 *
 * Three tabs, split by what is needed at the same moment: the booking itself,
 * who is staying, and the bill. Charges, payments and invoices are one Bill
 * because they answer one question -- what does this guest owe -- and are
 * read together at check-out. The status, room, balance and the next desk
 * action sit above the tabs, so they are in view whichever tab is open. A
 * new booking shows only Details: there is nothing to bill until it exists.
 */

const TABS = [
  { id: "details", label: "Details" },
  { id: "guests", label: "Guests" },
  { id: "bill", label: "Bill" },
];

/** The Bill's parts, top to bottom, and the old tab ids that now open them. */
const BILL_SECTIONS = [
  { id: "inclusions", label: "Charges", jump: "+ Add service" },
  { id: "payments", label: "Payments", jump: "Collect payment" },
  { id: "invoices", label: "Invoices", jump: "Invoice" },
];
const BILL_IDS = new Set(BILL_SECTIONS.map((x) => x.id));

const STATUS_LABELS = {
  inquiry: "Inquiry",
  confirmed: "Confirmed",
  in_house: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

/** What the desk can do next, given where the stay is now. */
const NEXT_ACTIONS = {
  inquiry: [{ status: "confirmed", label: "Confirm", kind: "btn-primary" }],
  confirmed: [
    { status: "in_house", label: "Check in", kind: "btn-primary" },
    { status: "no_show", label: "No show", kind: "btn-ghost" },
  ],
  in_house: [{ status: "checked_out", label: "Check out", kind: "btn-primary" }],
  checked_out: [],
  cancelled: [{ status: "confirmed", label: "Reinstate", kind: "btn-secondary" }],
  no_show: [{ status: "confirmed", label: "Reinstate", kind: "btn-secondary" }],
};

export default function BookingModal({
  session,
  reservationId,
  initialTab = "details",
  prefill,
  extras,
  onClose,
  onChanged,
}) {
  const isNew = !reservationId;

  // Opened from the tape chart's menu, a booking starts on the tab for the job
  // it was opened for; the add form there is ready until the desk moves away.
  // Callers still ask for "payments" or "invoices"; those open the Bill at
  // that part.
  const [tab, setTab] = useState(isNew ? "details" : BILL_IDS.has(initialTab) ? "bill" : initialTab);
  const [intent, setIntent] = useState(isNew ? null : initialTab);
  const sectionRefs = useRef({});
  const [folio, setFolio] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialog = useDialog();

  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [ratePlans, setRatePlans] = useState([]);

  const propertyId = session?.propertyId || null;
  const desk = useFrontDesk(propertyId);

  // Bring the part of the Bill the desk asked for into view.
  useEffect(() => {
    if (tab !== "bill" || !BILL_IDS.has(intent)) return;
    sectionRefs.current[intent]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tab, intent, folio]);

  const loadFolio = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pms/folio?reservationId=${reservationId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the booking");
      setFolio(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [reservationId, isNew]);

  // Only the first load blanks the modal. A payment or a charge reloads the
  // folio, and the tab should stay where it is while that happens.
  const firstLoad = loading && !folio;

  /** The setup the Details form needs to offer rooms and plans. */
  const loadSetup = useCallback(async () => {
    const qs = propertyId ? `?propertyId=${propertyId}` : "";
    try {
      const [typesRes, roomsRes, plansRes] = await Promise.all([
        fetch(`/api/setup/roomTypes${qs}`),
        fetch(`/api/pms/rooms${qs}`),
        fetch(`/api/setup/ratePlans${qs}`),
      ]);
      const [types, roomData, plans] = await Promise.all([
        typesRes.json(),
        roomsRes.json(),
        plansRes.json(),
      ]);
      setRoomTypes(types.roomTypes || []);
      setRooms(roomData.rooms || []);
      setRatePlans(plans.ratePlans || []);
    } catch {
      // The form says what is missing when it cannot offer anything.
    }
  }, [propertyId]);

  useEffect(() => {
    loadFolio();
    loadSetup();
  }, [loadFolio, loadSetup]);

  // Escape closes, which is what every modal is expected to do.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reservation = folio?.reservation;

  /**
   * The group this stay was booked under, with its other rooms, so the desk
   * handling one room of a wedding can see the rest of the party.
   */
  const [group, setGroup] = useState(null);
  const groupId = reservation?.group_id || null;
  useEffect(() => {
    if (!groupId) {
      setGroup(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/pms/groups?id=${groupId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setGroup(d?.group || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  /**
   * Check-in and check-out go through the shared front-desk step: a room
   * picked from a list when none is assigned, and any balance taken on the
   * way out.
   */
  async function deskAction(action) {
    setBusy(true);
    setError(null);
    try {
      const data = await action(reservation);
      if (!data) return;
      await loadFolio();
      onChanged?.(inventoryWarning(data));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pms/reservations/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reservationId, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the booking");
      await loadFolio();
      onChanged?.(inventoryWarning(data));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * A confirmed booking cancels at once, with an Undo that reinstates it.
   * An inquiry asks first: a cancelled booking can only come back as
   * confirmed, so an inquiry could not be put back as it was.
   */
  async function cancelBooking() {
    const { guest_name: guest, reference, status } = reservation;
    if (status === "inquiry") {
      const yes = await dialog.confirm({
        title: `Cancel ${guest}'s inquiry ${reference}?`,
        message: "A cancelled inquiry cannot be put back as an inquiry.",
        confirmLabel: "Cancel inquiry",
        cancelLabel: "Keep it",
        danger: true,
      });
      if (yes) await changeStatus("cancelled");
      return;
    }
    if (!(await changeStatus("cancelled"))) return;
    // The undo may run after this modal has closed, so it does its own
    // request rather than leaning on the modal's state.
    toast(`${guest}'s booking ${reference} cancelled`, {
      undo: async () => {
        const res = await fetch("/api/pms/reservations/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: reservationId, status: "confirmed" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not reinstate the booking");
        loadFolio();
        onChanged?.(inventoryWarning(data));
      },
    });
  }

  const actions = reservation ? NEXT_ACTIONS[reservation.status] || [] : [];

  const whatsapp = reservation
    ? whatsappLink(reservation, {
        propertyName: session?.propertyName,
        countryCode: toCountryCode(session?.propertyCountry),
        balance: folio?.totals?.balance,
      })
    : null;

  async function folioChanged() {
    await loadFolio();
    onChanged?.();
  }

  // A stay that has not started yet cannot be checked in. The action stays
  // visible -- hiding it would leave the desk wondering where check-in went --
  // but it is disabled and says why.
  const tooEarly =
    reservation && reservation.check_in > todayUTC()
      ? `Arrives ${reservation.check_in} — check-in opens that day`
      : null;

  // Nor can a guest go into a room still waiting to be cleaned. The server
  // refuses it too; this says why before the desk tries.
  const assignedRoom = reservation && rooms.find((r) => r.id === reservation.room_id);
  const roomDirty =
    reservation?.status === "confirmed" && assignedRoom?.housekeeping === "dirty"
      ? `Room ${assignedRoom.room_number} is dirty — mark it clean first`
      : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "2rem 1rem",
        overflowY: "auto",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 880, background: "var(--surface)" }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "0.85rem 1.1rem",
            background: "var(--accent)",
            color: "#fff",
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {isNew
              ? prefill?.booking_type === "complimentary"
                ? "New complimentary stay"
                : "New booking"
              : `Edit reservation — ${reservation?.reference || ""} for ${
                  reservation?.guest_name || ""
                }`}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: "1.1rem",
              cursor: "pointer",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Always in view: where the stay stands, what is owed, and the
            next desk action. */}
        {!isNew && reservation && (
          <div
            className="flex flex-wrap items-center gap-2 text-sm"
            style={{ padding: "0.6rem 1.1rem", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}
          >
            <span className="chip chip-off">
              {STATUS_LABELS[reservation.status] || reservation.status}
            </span>
            {reservation.rooms?.room_number && (
              <span className="chip chip-ok">Room {reservation.rooms.room_number}</span>
            )}
            {reservation.booking_type === "complimentary" && (
              <span className="chip chip-off">Complimentary</span>
            )}
            {group && (
              <span
                className="chip chip-off"
                title={group.reservations
                  .map(
                    (m) =>
                      `${m.rooms?.room_number ? `Room ${m.rooms.room_number}` : m.room_types?.room_type_name} · ${m.guest_name} · ${m.reference}`
                  )
                  .join("\n")}
              >
                Group: {group.name} · {group.reservations.length} room
                {group.reservations.length === 1 ? "" : "s"}
              </span>
            )}
            {folio?.totals && (
              <button
                type="button"
                className="chip"
                title="Open the bill"
                onClick={() => {
                  setTab("bill");
                  setIntent("payments");
                }}
                style={{
                  background: folio.totals.balance > 0 ? "var(--warn-soft)" : "var(--surface)",
                  color: folio.totals.balance > 0 ? "var(--warn)" : "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                {folio.totals.balance > 0
                  ? `Owes ₹${folio.totals.balance.toLocaleString("en-IN")}`
                  : folio.totals.balance < 0
                    ? `Refund due ₹${(-folio.totals.balance).toLocaleString("en-IN")}`
                    : "Paid in full"}
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {whatsapp ? (
                <a className="btn btn-secondary text-sm" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  Send on WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  disabled
                  title="Add the guest's phone number to send on WhatsApp"
                >
                  Send on WhatsApp
                </button>
              )}
              {(reservation.status === "confirmed" || reservation.status === "inquiry") && (
                <button
                  className="btn btn-ghost text-sm"
                  style={{ color: "var(--danger)" }}
                  onClick={cancelBooking}
                  disabled={busy}
                >
                  Cancel {reservation.status === "inquiry" ? "inquiry" : "booking"}
                </button>
              )}
              {actions.map((a) => {
                const blocked = a.status === "in_house" && (tooEarly || roomDirty);
                return (
                  <button
                    key={a.status}
                    className={`btn ${a.kind} text-sm`}
                    disabled={busy || Boolean(blocked)}
                    title={blocked || undefined}
                    onClick={() =>
                      a.status === "in_house"
                        ? deskAction(desk.checkIn)
                        : a.status === "checked_out"
                          ? deskAction(desk.checkOut)
                          : changeStatus(a.status)
                    }
                  >
                    {a.status === "checked_out" && folio?.totals?.balance > 0
                      ? `Collect ₹${folio.totals.balance.toLocaleString("en-IN")} & check out`
                      : a.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        {!isNew && (
          <div
            style={{
              display: "flex",
              gap: "0.25rem",
              padding: "0.5rem 1.1rem 0",
              borderBottom: "1px solid var(--border)",
              flexWrap: "wrap",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setIntent(null);
                }}
                className="btn text-xs"
                style={{
                  borderRadius: "4px 4px 0 0",
                  background: tab === t.id ? "var(--surface)" : "transparent",
                  border:
                    tab === t.id ? "1px solid var(--border)" : "1px solid transparent",
                  borderBottom: tab === t.id ? "1px solid var(--surface)" : undefined,
                  marginBottom: -1,
                  color: tab === t.id ? "var(--accent-text)" : "var(--text-muted)",
                  fontWeight: tab === t.id ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="card-pad space-y-3">
          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          {firstLoad && <p className="sub">Loading…</p>}

          {!firstLoad && (tab === "details" || isNew) && (
            <>
              <BookingForm
                session={session}
                reservation={reservation}
                prefill={prefill}
                roomTypes={roomTypes}
                rooms={rooms}
                ratePlans={ratePlans}
                embedded
                onSaved={async (_message, warning) => {
                  onChanged?.(warning);
                  if (isNew) onClose();
                  else await loadFolio();
                }}
                onCancel={onClose}
              />
            </>
          )}

          {!firstLoad && !isNew && tab === "guests" && folio && (
            <FolioTabs
              tab="guests"
              folio={folio}
              extras={extras}
              reservationId={reservationId}
              intent={null}
              onChanged={folioChanged}
            />
          )}

          {!firstLoad && !isNew && tab === "bill" && folio && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {BILL_SECTIONS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className={`btn text-sm ${x.id === "payments" && folio.totals?.balance > 0 ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setIntent(x.id)}
                  >
                    {x.jump}
                  </button>
                ))}
              </div>
              {BILL_SECTIONS.map((x) => (
                <section
                  key={x.id}
                  ref={(el) => {
                    sectionRefs.current[x.id] = el;
                  }}
                  className="space-y-2"
                  style={{ scrollMarginTop: 12 }}
                >
                  <h4
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--text-muted)",
                    }}
                  >
                    {x.label}
                  </h4>
                  {/* Keyed by whether it was jumped to, so its form starts
                      focused (and a payment starts at what is owed). */}
                  <FolioTabs
                    key={`${x.id}-${intent === x.id}`}
                    tab={x.id}
                    folio={folio}
                    extras={extras}
                    reservationId={reservationId}
                    intent={intent === x.id ? x.id : null}
                    onChanged={folioChanged}
                  />
                </section>
              ))}
            </div>
          )}
        </div>

      </div>
      {desk.settleDialog}
    </div>
  );
}
