"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateISO } from "@/lib/date";
import Icon from "../../components/Icon";
import { usePageState } from "./usePageState";

/**
 * The housekeeping board: every room, whether it is clean, and whether
 * anyone is in it, leaving it or arriving to it today.
 *
 * The two axes are shown side by side on purpose. "Dirty" alone does not say
 * what to do; "vacant dirty with an arrival today" does, and it is the first
 * room to clean. The front-office shorthand -- VC, VD, OC, OD, OOO -- is
 * shown because it is what the desk and housekeeping already say to each
 * other.
 *
 * Checking a guest out marks their room dirty automatically, so the board is
 * right without anyone having to remember to tell housekeeping.
 */

/**
 * Each status is an icon, a colour and a word together. Housekeeping staff
 * often read English as a second language, and about one man in twelve
 * cannot tell the colours apart, so no status relies on one of the three.
 */
const STATUSES = [
  { id: "dirty", label: "Dirty", chip: "chip-warn", icon: "broom" },
  { id: "clean", label: "Clean", chip: "chip-ok", icon: "check" },
  { id: "inspected", label: "Inspected", chip: "chip-ok", icon: "checks" },
  { id: "out_of_order", label: "Out of order", chip: "chip-off", icon: "blocked" },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

/**
 * The board's words in the languages housekeeping teams here speak. Only
 * this page is translated: it is the one used by staff who may not read
 * English comfortably. The choice is remembered per phone.
 */
const LANGS = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "ta", label: "தமிழ்" },
  { id: "kn", label: "ಕನ್ನಡ" },
];
const WORDS = {
  hi: {
    Dirty: "गंदा", Clean: "साफ़", Inspected: "जाँचा गया", "Out of order": "खराब",
    "Mark clean": "साफ़ हो गया", Undo: "वापस लें", "To clean": "साफ़ करना है", Ready: "तैयार",
    Occupied: "मेहमान हैं", Arrivals: "आने वाले", Departures: "जाने वाले", "All rooms": "सभी कमरे",
    Room: "कमरा", Status: "स्थिति", Guest: "मेहमान", Arrival: "आगमन", "Due out": "आज जाएँगे",
    Vacant: "खाली", Departed: "चले गए", Floor: "मंज़िल", "All floors": "सभी मंज़िलें",
  },
  ta: {
    Dirty: "அழுக்கு", Clean: "சுத்தம்", Inspected: "சரிபார்க்கப்பட்டது", "Out of order": "பழுது",
    "Mark clean": "சுத்தம் ஆனது", Undo: "திரும்பப் பெறு", "To clean": "சுத்தம் செய்ய", Ready: "தயார்",
    Occupied: "விருந்தினர் உள்ளனர்", Arrivals: "வருகை", Departures: "புறப்பாடு", "All rooms": "அனைத்து அறைகள்",
    Room: "அறை", Status: "நிலை", Guest: "விருந்தினர்", Arrival: "வருகை", "Due out": "இன்று புறப்பாடு",
    Vacant: "காலி", Departed: "புறப்பட்டார்", Floor: "தளம்", "All floors": "அனைத்து தளங்கள்",
  },
  kn: {
    Dirty: "ಕೊಳಕು", Clean: "ಸ್ವಚ್ಛ", Inspected: "ಪರಿಶೀಲಿಸಲಾಗಿದೆ", "Out of order": "ದುರಸ್ತಿಯಲ್ಲಿ",
    "Mark clean": "ಸ್ವಚ್ಛವಾಯಿತು", Undo: "ರದ್ದುಮಾಡಿ", "To clean": "ಸ್ವಚ್ಛಗೊಳಿಸಬೇಕು", Ready: "ಸಿದ್ಧ",
    Occupied: "ಅತಿಥಿ ಇದ್ದಾರೆ", Arrivals: "ಆಗಮನ", Departures: "ನಿರ್ಗಮನ", "All rooms": "ಎಲ್ಲಾ ಕೋಣೆಗಳು",
    Room: "ಕೋಣೆ", Status: "ಸ್ಥಿತಿ", Guest: "ಅತಿಥಿ", Arrival: "ಆಗಮನ", "Due out": "ಇಂದು ನಿರ್ಗಮನ",
    Vacant: "ಖಾಲಿ", Departed: "ಹೊರಟಿದ್ದಾರೆ", Floor: "ಮಹಡಿ", "All floors": "ಎಲ್ಲಾ ಮಹಡಿಗಳು",
  },
};
const LANG_KEY = "hms.housekeepingLang";

/** A status as a chip: icon, colour and word. */
function StatusBadge({ status, t }) {
  const s = STATUS[status] || STATUS.dirty;
  return (
    <span className={`chip ${s.chip}`} style={{ gap: 4, fontWeight: 600 }}>
      <Icon name={s.icon} size={14} strokeWidth={2} />
      {t(s.label)}
    </span>
  );
}

/** The code the desk uses, e.g. VD = vacant and dirty. */
function roomCode(room) {
  if (room.housekeeping === "out_of_order") return "OOO";
  const occupancy = room.occupied ? "O" : "V";
  const clean = room.housekeeping === "dirty" ? "D" : "C";
  return occupancy + clean;
}

function occupancyLabel(room) {
  if (room.occupied && room.departing) return "Due out";
  if (room.occupied) return "Occupied";
  if (room.departing?.status === "checked_out") return "Departed";
  return "Vacant";
}

/**
 * How urgently a room needs housekeeping. A dirty room with a guest on the
 * way is first; an out-of-order room is last because nobody can use it.
 */
function priority(room) {
  if (room.housekeeping === "out_of_order") return 9;
  const dirty = room.housekeeping === "dirty";
  if (dirty && room.arriving && !room.occupied) return 0;
  if (dirty && !room.occupied) return 1;
  if (room.housekeeping === "clean" && room.arriving) return 2; // to inspect
  if (dirty) return 3; // stay-over service
  return 5;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}


export default function Housekeeping({ session }) {
  const propertyId = session?.propertyId || null;

  const [date, setDate] = usePageState("housekeeping.date", () => formatDateISO(new Date()));
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Opens on the work still to do, most urgent first: that is what anyone
  // opening this page has come to see. "All rooms" is one tap away.
  const [view, setView] = usePageState("housekeeping.view", "todo");
  const [floorFilter, setFloorFilter] = usePageState("housekeeping.floor", "");
  const [byPriority, setByPriority] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  // The last change, so a slip of the finger can be put back. In "To clean"
  // a room marked clean leaves the list at once, so without this a wrong tap
  // would mean finding the room again under "All rooms".
  const [lastChange, setLastChange] = useState(null);

  const [lang, setLang] = useState("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (LANGS.some((l) => l.id === saved)) setLang(saved);
    } catch {}
  }, []);
  function chooseLang(id) {
    setLang(id);
    try {
      localStorage.setItem(LANG_KEY, id);
    } catch {}
  }
  const t = (word) => WORDS[lang]?.[word] || word;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date });
      if (propertyId) qs.set("propertyId", propertyId);
      const res = await fetch(`/api/pms/housekeeping?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load housekeeping");
      setRooms(data.rooms || []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const floors = useMemo(
    () =>
      [...new Set(rooms.map((r) => r.floor).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      ),
    [rooms]
  );

  const summary = useMemo(() => {
    const s = { VC: 0, VD: 0, OC: 0, OD: 0, OOO: 0, arrivals: 0, departures: 0 };
    for (const r of rooms) {
      s[roomCode(r)] += 1;
      if (r.arriving) s.arrivals += 1;
      if (r.departing) s.departures += 1;
    }
    return s;
  }, [rooms]);

  /**
   * The counts across the top are the filters: tapping "To clean 6" shows
   * those six. One row of controls instead of a row of figures and a second
   * row of buttons saying the same thing. The desk's codes stay as a small
   * second line, since that is how the desk talks.
   */
  const tiles = [
    { id: "todo", label: "To clean", count: summary.VD + summary.OD, code: "VD + OD", icon: "broom" },
    { id: "ready", label: "Ready", count: summary.VC, code: "VC", icon: "check" },
    { id: "occupied", label: "Occupied", count: summary.OC + summary.OD, code: "OC + OD", icon: "bed" },
    { id: "arrivals", label: "Arrivals", count: summary.arrivals, icon: "arrive" },
    { id: "departures", label: "Departures", count: summary.departures, icon: "depart" },
    { id: "ooo", label: "Out of order", count: summary.OOO, code: "OOO", icon: "blocked" },
    { id: "all", label: "All rooms", count: rooms.length, icon: "list" },
  ];

  const visible = useMemo(() => {
    const list = rooms.filter((r) => {
      if (floorFilter && (r.floor || "") !== floorFilter) return false;
      switch (view) {
        case "todo":
          return r.housekeeping === "dirty";
        case "ready":
          return roomCode(r) === "VC";
        case "arrivals":
          return !!r.arriving;
        case "departures":
          return !!r.departing;
        case "occupied":
          return !!r.occupied;
        case "ooo":
          return r.housekeeping === "out_of_order";
        default:
          return true;
      }
    });
    // Array.prototype.sort is stable, so equal priorities keep room order.
    return byPriority ? [...list].sort((a, b) => priority(a) - priority(b)) : list;
  }, [rooms, view, floorFilter, byPriority]);

  async function mark(ids, status, { undoable = true } = {}) {
    if (ids.length === 0) return;
    setError(null);
    const previous = rooms;
    const before = rooms.filter((r) => ids.includes(r.id) && r.housekeeping !== status);
    setRooms((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, housekeeping: status } : r))
    );
    try {
      const res = await fetch("/api/pms/housekeeping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, ids, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update housekeeping");
      // The response carries the rooms only; keep the stay details the board
      // already has for them.
      const byId = Object.fromEntries((data.rooms || []).map((r) => [r.id, r]));
      setRooms((prev) => prev.map((r) => (byId[r.id] ? { ...r, ...byId[r.id] } : r)));
      setSelected(new Set());
      setLastChange(
        undoable && before.length
          ? {
              status,
              rooms: before.map((r) => ({
                id: r.id,
                number: r.room_number,
                housekeeping: r.housekeeping,
              })),
            }
          : null
      );
    } catch (err) {
      setRooms(previous);
      setError(err.message);
    }
  }

  /** Put the last change back, room by room, as each was before. */
  async function undo() {
    if (!lastChange) return;
    const byStatus = {};
    for (const r of lastChange.rooms) (byStatus[r.housekeeping] ||= []).push(r.id);
    setLastChange(null);
    for (const [status, ids] of Object.entries(byStatus)) {
      await mark(ids, status, { undoable: false });
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));
  }

  const today = formatDateISO(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="h1">Housekeeping</h2>
          <p className="sub">
            Room status for the day, next to who is in, leaving or arriving.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          {date !== today && (
            <button className="btn btn-ghost text-sm" onClick={() => setDate(today)}>
              Today
            </button>
          )}
          <button className="btn btn-ghost text-sm" onClick={load}>
            Refresh
          </button>
          <select
            className="input"
            style={{ width: "auto" }}
            value={lang}
            onChange={(e) => chooseLang(e.target.value)}
            aria-label="Language"
          >
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))" }}
        role="group"
        aria-label="Show rooms"
      >
        {tiles.map((tile) => {
          const on = view === tile.id;
          return (
            <button
              key={tile.id}
              type="button"
              className="card card-pad text-left"
              aria-pressed={on}
              onClick={() => setView(tile.id)}
              style={{
                borderColor: on ? "var(--accent)" : undefined,
                boxShadow: on ? "0 0 0 1px var(--accent)" : undefined,
                minHeight: 72,
              }}
            >
              <div className="flex items-center gap-1.5 text-xs" style={{ color: on ? "var(--accent-text)" : "var(--text-muted)", fontWeight: 600 }}>
                <Icon name={tile.icon} size={14} strokeWidth={2} />
                {t(tile.label)}
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{tile.count}</div>
              {tile.code && (
                <div style={{ fontSize: "0.65rem", color: "var(--text-faint)" }}>{tile.code}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <select
          className="input"
          style={{ width: "auto" }}
          value={floorFilter}
          onChange={(e) => setFloorFilter(e.target.value)}
        >
          <option value="">{t("All floors")}</option>
          {floors.map((f) => (
            <option key={f} value={f}>
              {t("Floor")} {f}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={byPriority}
            onChange={(e) => setByPriority(e.target.checked)}
          />
          Priority first
        </label>
      </div>

      {lastChange && (
        <div className="card px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
          <span>
            {lastChange.rooms.length === 1
              ? `Room ${lastChange.rooms[0].number}`
              : `${lastChange.rooms.length} rooms`}{" "}
            → {t(STATUS[lastChange.status]?.label || lastChange.status)}
          </span>
          <button className="btn btn-secondary text-sm" onClick={undo}>
            {t("Undo")}
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="card card-pad flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ fontWeight: 600 }}>
            {selected.size} selected — mark as
          </span>
          {STATUSES.map((s) => (
            <button
              key={s.id}
              className="btn btn-ghost text-sm"
              onClick={() => mark([...selected], s.id)}
            >
              <Icon name={s.icon} size={14} strokeWidth={2} /> {t(s.label)}
            </button>
          ))}
          <button className="btn btn-ghost text-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto card" style={{ padding: 0 }}>
        <table className="cm-grid">
          <thead>
            <tr>
              {/* The room stays in view on a phone, with its select box and
                  the one-tap Clean beside it, so marking a room never needs
                  a sideways scroll. */}
              <th className="cm-sticky">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    title="Select all shown"
                    aria-label="Select all shown"
                  />
                  {t("Room")}
                </span>
              </th>
              <th>{t("Status")}</th>
              <th>{t("Guest")}</th>
              <th>Type</th>
              <th>{t("Floor")}</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {/* Only while there is nothing to show yet; a reload keeps the
                rooms on screen instead of blanking the table. */}
            {loading && rooms.length === 0 && (
              <tr>
                <td colSpan={6} className="sub">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rooms.length === 0 && (
              <tr>
                <td colSpan={6} className="sub">
                  No rooms yet — add them under Setup → Rooms.
                </td>
              </tr>
            )}
            {rooms.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="sub">
                  Nothing here for this view.
                </td>
              </tr>
            )}
            {visible.map((room) => {
              const guest = room.occupied || room.arriving || room.departing;
              return (
                <tr key={room.id}>
                  <td className="cm-sticky">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(room.id)}
                        onChange={() => toggle(room.id)}
                        aria-label={`Select room ${room.room_number}`}
                      />
                      <span style={{ fontWeight: 700, fontSize: "1rem", minWidth: "2.75rem" }}>
                        {room.room_number}
                      </span>
                      {/* The one job most rows need, as a big target. */}
                      {room.housekeeping === "dirty" && (
                        <button
                          className="btn btn-primary text-sm"
                          style={{ minHeight: 40, padding: "0.35rem 0.8rem", whiteSpace: "nowrap" }}
                          onClick={() => mark([room.id], "clean")}
                        >
                          <Icon name="check" size={16} strokeWidth={2.2} /> {t("Mark clean")}
                        </button>
                      )}
                    </span>
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={room.housekeeping} t={t} />
                      {room.arriving && (
                        <span className="chip chip-booked" style={{ gap: 4 }}>
                          <Icon name="arrive" size={13} strokeWidth={2} />
                          {t("Arrival")}
                        </span>
                      )}
                      <select
                        className="input"
                        style={{ width: "auto", padding: "0.25rem 1.6rem 0.25rem 0.4rem", fontSize: "0.8rem", backgroundPosition: "right 0.45rem center" }}
                        value={room.housekeeping}
                        onChange={(e) => mark([room.id], e.target.value)}
                        aria-label={`Change room ${room.room_number}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {t(s.label)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginTop: 2 }}>
                      {t(occupancyLabel(room))} · {roomCode(room)}
                    </div>
                  </td>
                  <td className="text-sm">
                    {guest ? (
                      <>
                        {guest.guest_name}
                        <span style={{ color: "var(--text-faint)" }}>
                          {" "}
                          · {guest.adults}A
                          {guest.children ? ` ${guest.children}C` : ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{room.room_types?.room_type_name || "—"}</td>
                  <td>{room.floor || "—"}</td>
                  <td className="sub" style={{ fontSize: "0.75rem" }}>
                    {timeAgo(room.housekeeping_updated_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
