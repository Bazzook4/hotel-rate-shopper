"use client";

import Icon from "../../components/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import BookingForm from "./BookingForm";
import FolioTabs from "./FolioTabs";
import { Fact, Facts } from "../../components/Facts";
import { hotelToday } from "@/lib/hotelTime";
import { inventoryWarning } from "@/lib/inventoryNotice";
import { useToast } from "../../components/Toast";
import { confirmDiscard, useDialog } from "../../components/Dialog";
import { useBackdropClose, useEscape } from "../../components/useEscape";
import { useFrontDesk, whatsappLink } from "./frontDesk";
import { toCountryCode } from "@/lib/countries";
import { visibleModules } from "../modules";
import RowMenu from "../../components/RowMenu";
import OnlineCheckinPanel, {
  CheckinFact,
  offersOnlineCheckin,
  onlineCheckinUrl,
  useOnlineCheckin,
} from "./OnlineCheckin";

/**
 * One booking, opened from the tape chart or any list.
 *
 * Three tabs, split by what is needed at the same moment: the booking itself,
 * who is staying, and the bill. The Bill is one statement read like the
 * printed folio, with Add service, Collect payment and Issue invoice as buttons
 * that open a drawer. The status, room, balance and the next desk
 * action sit above the tabs, so they are in view whichever tab is open. A
 * new booking shows only Details: there is nothing to bill until it exists.
 */

const TABS = [
  { id: "details", label: "Details" },
  { id: "guests", label: "Guests" },
  { id: "bill", label: "Bill" },
  { id: "invoices", label: "Invoices" },
];

/** The jobs callers can open a booking for, each one a drawer on the Bill or Invoices tab. */
const BILL_IDS = new Set(["inclusions", "payments"]);

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

/** "2026-10-22" as "22 Oct". */
const shortDate = (iso) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : "";

/** The stay in one line: dates, nights and who, the first thing checked at the desk. */
function stayLine(r) {
  const who = [
    `${r.adults ?? 0} adult${r.adults === 1 ? "" : "s"}`,
    r.children > 0 && `${r.children} child${r.children === 1 ? "" : "ren"}`,
  ].filter(Boolean);
  if (r.day_use_hours) {
    const from = String(r.day_use_start || "").slice(0, 5);
    return [shortDate(r.check_in), `day use${from ? ` from ${from}` : ""}`, ...who].join(", ");
  }
  const nights = Math.max(0, Math.round((new Date(r.check_out) - new Date(r.check_in)) / 86400000));
  return [`${shortDate(r.check_in)} to ${shortDate(r.check_out)}`, `${nights} night${nights === 1 ? "" : "s"}`, ...who].join(", ");
}

/** What the bill stands at; a complimentary stay says so first. */
function balanceLine(balance, comp) {
  const money = (n) => `₹${n.toLocaleString("en-IN")}`;
  const text =
    balance > 0
      ? `owes ${money(balance)}`
      : balance < 0
        ? `refund due ${money(-balance)}`
        : comp
          ? "nothing to pay"
          : "paid in full";
  const line = comp ? `Complimentary, ${text}` : text;
  return line[0].toUpperCase() + line.slice(1);
}

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
  // it was opened for. Adding a service, taking a payment or issuing an
  // invoice opens the Bill with that job's drawer already open.
  const [tab, setTab] = useState(isNew ? "details" : BILL_IDS.has(initialTab) ? "bill" : initialTab);
  const [intent, setIntent] = useState(isNew ? null : initialTab);
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
  const desk = useFrontDesk(propertyId, { canSeeIds: visibleModules(session).some((p) => p.id === "guests") });

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

  /**
   * Unsaved edits on Details. Escape, the close button and switching tab all
   * ask before throwing them away; a click outside the window is ignored while
   * there are any, since a stray click is no reason to lose a booking.
   */
  const [dirty, setDirty] = useState(false);
  // While a save is on its way the window stays: closing then would say
  // "nothing has been saved" about a booking that is about to exist.
  const [saving, setSaving] = useState(false);
  const asking = useRef(false);

  async function leaveDetails() {
    if (!dirty) return true;
    if (asking.current) return false;
    asking.current = true;
    const discard = await confirmDiscard(dialog, !isNew);
    asking.current = false;
    if (!discard) return false;
    setDirty(false);
    return true;
  }

  async function requestClose() {
    if (saving) return;
    if (await leaveDetails()) onClose();
  }

  useEscape(requestClose);
  const backdrop = useBackdropClose(() => {
    if (!dirty && !saving) onClose();
  });

  const reservation = folio?.reservation;

  // The guest's online check-in. Reloaded when the stay moves on, since a
  // guest who has arrived can no longer change what they sent.
  const checkin = useOnlineCheckin(isNew ? null : reservationId);
  const reloadCheckin = checkin.reload;
  const stayStatus = reservation?.status;
  useEffect(() => {
    if (stayStatus) reloadCheckin();
  }, [stayStatus, reloadCheckin]);
  const showCheckin = offersOnlineCheckin(checkin.data, reservation);
  const checkinStatus = checkin.data?.checkin?.status;

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
        // An unanswered online check-in link goes out with the confirmation.
        checkinUrl:
          checkin.data?.checkin && !checkin.data.checkin.closed && checkinStatus !== "accepted"
            ? onlineCheckinUrl(checkin.data)
            : null,
      })
    : null;

  async function folioChanged() {
    await loadFolio();
    onChanged?.();
  }

  // A stay that has not started yet cannot be checked in. The action stays
  // visible -- hiding it would leave the desk wondering where check-in went --
  // but it is disabled, and the Status fact says when it opens.
  const tooEarly =
    reservation?.status === "confirmed" && reservation.check_in > hotelToday()
      ? `Arrives ${shortDate(reservation.check_in)}. Check-in opens that day`
      : null;

  // A room still waiting to be cleaned shows on the Room fact, which marks it
  // clean in one click. Check in stays open: the desk step asks whether the
  // room is ready and marks it clean on the way in.
  const assignedRoom = reservation && rooms.find((r) => r.id === reservation.room_id);
  const roomDirty = reservation?.status === "confirmed" && assignedRoom?.housekeeping === "dirty";
  const canHousekeep = visibleModules(session).some((p) => p.id === "housekeeping");
  // ID photos need the Guests page itself, as on the server.
  const canSeeIds = visibleModules(session).some((p) => p.id === "guests");

  async function markRoomClean() {
    setError(null);
    try {
      const res = await fetch("/api/pms/housekeeping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, ids: [assignedRoom.id], status: "clean" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not mark the room clean");
      setRooms((prev) => prev.map((x) => (x.id === assignedRoom.id ? { ...x, housekeeping: "clean" } : x)));
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const balance = folio?.totals?.balance;
  const owes = balance > 0;
  // The Invoices tab says what waits there: how many stand, or what is still to issue.
  const toIssue = (folio?.charges || []).filter((c) => !c.invoice).length;
  const standing = (folio?.invoices || []).filter((i) => !i.voided_at).length;
  const invoicesLabel =
    standing > 0 && toIssue > 0
      ? `Invoices (${standing}), ${toIssue} to issue`
      : standing > 0
        ? `Invoices (${standing})`
        : "Invoices";
  const openPayments = async () => {
    if (!(await leaveDetails())) return;
    setTab("bill");
    setIntent("payments");
  };

  function runAction(status) {
    if (status === "in_house") return deskAction(desk.checkIn);
    if (status === "checked_out") return deskAction(desk.checkOut);
    return changeStatus(status);
  }

  // The toolbar holds the next step, Take payment and WhatsApp. Steps taken
  // now and then, and the ones that undo a stay, wait under More.
  const moreItems = reservation
    ? [
        !whatsapp && {
          label: "Send on WhatsApp (add the guest's phone first)",
          disabled: true,
        },
        ...actions
          .filter((a) => a.kind === "btn-ghost")
          .map((a) => ({ label: a.label, disabled: busy, onClick: () => runAction(a.status) })),
        (reservation.status === "confirmed" || reservation.status === "inquiry") && {
          label: `Cancel ${reservation.status === "inquiry" ? "inquiry" : "booking"}`,
          danger: true,
          disabled: busy,
          onClick: cancelBooking,
        },
      ].filter(Boolean)
    : [];

  return (
    <div
      {...backdrop}
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
              : `Edit reservation: ${reservation?.reference || ""} for ${
                  reservation?.guest_name || ""
                }`}
          </div>
          <button type="button" className="head-close" onClick={requestClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Always in view: where the stay stands, what is owed, and the
            next desk action. */}
        {!isNew && reservation && (
          <div
            className="flex flex-col gap-3 text-sm"
            style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}
          >
            <Facts>
              <Fact label="Status" tone={tooEarly ? "warn" : undefined}>
                {STATUS_LABELS[reservation.status] || reservation.status}
                {tooEarly && `, arrives ${shortDate(reservation.check_in)}`}
              </Fact>
              <Fact label="Stay">{stayLine(reservation)}</Fact>
              {reservation.booker_name && (
                <Fact label="Booked by" title={reservation.booker_email || undefined}>
                  {[reservation.booker_name, reservation.booker_phone].filter(Boolean).join(", ")}
                </Fact>
              )}
              {roomDirty ? (
                <Fact
                  label="Room"
                  tone="warn"
                  onClick={canHousekeep ? markRoomClean : undefined}
                  title={canHousekeep ? `Mark room ${assignedRoom.room_number} clean` : "Waiting to be cleaned"}
                >
                  {assignedRoom.room_number}, dirty{canHousekeep && ". Mark clean"}
                </Fact>
              ) : (
                <Fact label="Room">{reservation.rooms?.room_number || "Not assigned"}</Fact>
              )}
              {group && (
                <Fact
                  label="Group"
                  title={group.reservations
                    .map(
                      (m) =>
                        `${m.rooms?.room_number ? `Room ${m.rooms.room_number}` : m.room_types?.room_type_name}, ${m.guest_name}, ${m.reference}`
                    )
                    .join("\n")}
                >
                  {group.name}, {group.reservations.length} room{group.reservations.length === 1 ? "" : "s"}
                </Fact>
              )}
              {folio?.totals && (
                <Fact
                  label="Balance"
                  tone={owes ? "warn" : balance === 0 ? "ok" : undefined}
                  title="Open the bill"
                  onClick={openPayments}
                >
                  {balanceLine(balance, reservation.booking_type === "complimentary")}
                </Fact>
              )}
              {showCheckin && (
                <CheckinFact
                  status={checkinStatus}
                  onClick={async () => {
                    if (tab === "guests" || !(await leaveDetails())) return;
                    setTab("guests");
                    setIntent(null);
                  }}
                />
              )}
            </Facts>

            <div className="flex flex-wrap items-center gap-2">
              {actions
                .filter((a) => a.kind !== "btn-ghost")
                .map((a) => {
                  const blocked = a.status === "in_house" && tooEarly;
                  return (
                    <button
                      key={a.status}
                      type="button"
                      className={`btn ${a.kind} text-sm`}
                      disabled={busy || Boolean(blocked)}
                      title={blocked || undefined}
                      onClick={() => runAction(a.status)}
                    >
                      {a.status === "checked_out" && owes
                        ? `Collect ₹${balance.toLocaleString("en-IN")} & check out`
                        : a.label}
                    </button>
                  );
                })}
              {owes && tab !== "bill" && (reservation.status === "confirmed" || reservation.status === "in_house") && (
                <button type="button" className="btn btn-secondary text-sm" onClick={openPayments}>
                  Take payment
                </button>
              )}
              {whatsapp && (
                <a className="btn btn-secondary text-sm" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  Send on WhatsApp
                </a>
              )}
              {moreItems.length > 0 && <RowMenu label="More" title={`Booking ${reservation.reference}`} items={moreItems} />}
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
                onClick={async () => {
                  if (t.id === tab || !(await leaveDetails())) return;
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
                {t.id === "invoices" ? invoicesLabel : t.label}
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

          {firstLoad && <p className="sub">Loading...</p>}

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
                onSaved={async (message, warning, saved) => {
                  if (saved?.checkIn) {
                    try {
                      const data = await desk.checkIn(saved.reservation, { roomSeenDirty: saved.roomSeenDirty });
                      toast(
                        data
                          ? `${saved.reservation.guest_name} checked in`
                          : `${message} Not checked in yet.`
                      );
                    } catch (err) {
                      toast(`The booking is saved, but not checked in: ${err.message}`, { tone: "error" });
                    }
                  } else if (isNew) {
                    toast(message);
                  }
                  onChanged?.(warning);
                  if (isNew) onClose();
                  else await loadFolio();
                }}
                onCancel={onClose}
                onDirtyChange={setDirty}
                onSavingChange={setSaving}
              />
            </>
          )}

          {!firstLoad && !isNew && tab === "guests" && folio && showCheckin && (
            <OnlineCheckinPanel
              reservation={reservation}
              data={checkin.data}
              setData={checkin.setData}
              session={session}
              onAccepted={folioChanged}
            />
          )}

          {!firstLoad && !isNew && tab === "guests" && folio && (
            <FolioTabs
              tab="guests"
              folio={folio}
              canSeeIds={canSeeIds}
              propertyId={reservation?.property_id}
              extras={extras}
              reservationId={reservationId}
              intent={null}
              onChanged={folioChanged}
            />
          )}

          {!firstLoad && !isNew && (tab === "bill" || tab === "invoices") && folio && (
            <FolioTabs
              tab={tab}
              folio={folio}
              extras={extras}
              reservationId={reservationId}
              intent={intent}
              onIntentDone={() => setIntent(null)}
              onTab={setTab}
              onChanged={folioChanged}
            />
          )}
        </div>

      </div>
      {desk.settleDialog}
    </div>
  );
}
