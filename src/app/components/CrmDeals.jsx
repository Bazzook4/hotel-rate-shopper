"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import Select from "./Select";
import DateField from "./DateField";
import { useEscape } from "./useEscape";
import { useDialog } from "./Dialog";
import { formatDateISO } from "@/lib/date";
import { LEAD_STATUS, LEAD_CHIP } from "./WhatsAppInbox";

/**
 * Super admin only: contacts and deals (migration 074).
 *
 * A contact is a person and their hotel, made when a developed lead is
 * converted. A deal is a try at winning that hotel, moved through Demo,
 * Link sent, Won and Lost. A contact can have many deals. Every enquiry makes
 * a contact the moment it arrives (migration 081). Deals is a table of all of
 * them: when it was received, where it stands, and how many bookings the hotel
 * has made since signing up, with the date of the last one; the stage board is
 * one click away. Both tabs open the same side panel.
 */

export const STAGES = { demo: "Demo", link_sent: "Onboarding link sent", won: "Won", lost: "Lost" };
const STAGE_CHIP = { demo: "chip-booked", link_sent: "chip-booked", won: "chip-ok", lost: "chip-off" };
const PANE_HEIGHT = "calc(100dvh - 15rem)";

async function api(method, body, query = "") {
  const r = await fetch(`/api/admin/crm${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || "Something went wrong");
    e.missing = j.missing;
    throw e;
  }
  return j;
}

const day = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const place = (c) => [c.hotel_name, c.city, c.rooms != null ? `${c.rooms} rooms` : null].filter(Boolean).join(", ");
const full = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const label = (c) => c.name || c.hotel_name || (c.phone ? `+${c.phone}` : "No name");

export default function CrmDeals({ view, openDealId, onOpenChat }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [board, setBoardState] = useState(() => typeof window !== "undefined" && localStorage.getItem("crmDealBoard") === "1");
  const setBoard = (on) => {
    setBoardState(on);
    localStorage.setItem("crmDealBoard", on ? "1" : "0");
  };

  const load = useCallback(async () => {
    try {
      setData(await api("GET"));
      setError("");
    } catch (e) {
      if (e.missing) setMissing(true);
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Arriving from Convert: open the contact that owns the new deal.
  useEffect(() => {
    if (!data || !openDealId) return;
    const c = data.contacts.find((x) => x.deals.some((d) => d.id === openDealId));
    if (c) setOpenId(c.id);
  }, [data, openDealId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return (data?.contacts || []).filter((c) => {
      if (!q) return true;
      return [c.name, c.email, c.hotel_name, c.city].filter(Boolean).join(" ").toLowerCase().includes(q) || (digits.length >= 3 && (c.phone || "").includes(digits));
    });
  }, [data, query]);

  if (missing) {
    return (
      <div className="rounded-xl border border-[var(--warn)] px-4 py-2 text-sm" style={{ color: "var(--warn)" }}>
        Contacts and deals are not switched on yet: run migration 074.
      </div>
    );
  }
  if (!data) return error ? <p className="text-sm text-[var(--danger)]">{error}</p> : <p className="sub">Loading...</p>;

  const open = data.contacts.find((c) => c.id === openId);
  const patchContact = (id, changes) =>
    setData((d) => ({ ...d, contacts: d.contacts.map((c) => (c.id === id ? { ...c, ...changes } : c)) }));
  const patchDeal = (contactId, deal) =>
    setData((d) => ({
      ...d,
      contacts: d.contacts.map((c) =>
        c.id !== contactId ? c : { ...c, deals: c.deals.some((x) => x.id === deal.id) ? c.deals.map((x) => (x.id === deal.id ? deal : x)) : [deal, ...c.deals] }
      ),
    }));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          className="input w-full text-sm md:w-64"
          type="search"
          placeholder="Search name, number, email, hotel, city"
          aria-label={view === "deals" ? "Search deals" : "Search contacts"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {view === "deals" && (
          <>
            <button type="button" aria-pressed={!board} className={!board ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"} onClick={() => setBoard(false)}>
              Table
            </button>
            <button type="button" aria-pressed={board} className={board ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"} onClick={() => setBoard(true)}>
              Board
            </button>
            {!board && <span className="text-xs muted">{rows.length} enquiries</span>}
          </>
        )}
        {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
      </div>

      {view === "deals" && !board ? (
        <EnquiryTable rows={rows} onOpen={setOpenId} onDeal={patchDeal} setError={setError} />
      ) : view === "deals" ? (
        <DealBoard rows={rows} onOpen={setOpenId} onDeal={patchDeal} setError={setError} />
      ) : (
        <ContactList rows={rows} onOpen={setOpenId} />
      )}

      {open && (
        <ContactPanel
          contact={open}
          hotels={data.hotels}
          onContact={patchContact}
          onDeal={patchDeal}
          onChat={onOpenChat}
          onGone={() => {
            setOpenId(null);
            load();
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function ContactList({ rows, onOpen }) {
  return (
    <div className="card overflow-x-auto">
      <table className="grid-table min-w-full text-sm">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Hotel</th>
            <th>City</th>
            <th>Rooms</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Deals</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No contacts yet. Every new enquiry appears here.
              </td>
            </tr>
          )}
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <button type="button" className="text-left text-ink underline" onClick={() => onOpen(c.id)}>
                  {label(c)}
                </button>
              </td>
              <td>{c.hotel_name || ""}</td>
              <td>{c.city || ""}</td>
              <td>{c.rooms ?? ""}</td>
              <td>{c.phone ? `+${c.phone}` : ""}</td>
              <td>{c.email || ""}</td>
              <td>
                {c.deals.length === 0
                  ? ""
                  : c.deals.map((d) => (
                      <span key={d.id} className={`chip mr-1 ${STAGE_CHIP[d.stage]}`}>
                        {STAGES[d.stage]}
                      </span>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every enquiry in one table. The status of a contact with a deal is its latest deal's stage, changed here; before that it is the lead's status. */
function EnquiryTable({ rows, onOpen, onDeal, setError }) {
  const list = useMemo(() => [...rows].sort((a, b) => String(b.received).localeCompare(String(a.received))), [rows]);

  async function move(c, deal, stage) {
    const before = deal;
    onDeal(c.id, { ...deal, stage });
    setError("");
    try {
      const r = await api("PATCH", { deal_id: deal.id, stage });
      onDeal(c.id, r.deal);
    } catch (e) {
      onDeal(c.id, before);
      setError(e.message);
    }
  }

  return (
    <div className="card overflow-x-auto">
      <table className="grid-table min-w-full text-sm">
        <thead>
          <tr>
            <th>Enquiry</th>
            <th>Received</th>
            <th>Current status</th>
            <th>Bookings created</th>
            <th>Last booking</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No enquiries yet.
              </td>
            </tr>
          )}
          {list.map((c) => {
            const deal = c.deals[0];
            return (
              <tr key={c.id}>
                <td>
                  <button type="button" className="text-left text-ink underline" onClick={() => onOpen(c.id)}>
                    {label(c)}
                  </button>
                  {place(c) && <span className="block text-xs muted">{place(c)}</span>}
                </td>
                <td>{full(c.received)}</td>
                <td>
                  {deal ? (
                    <Select value={deal.stage} onChange={(e) => move(c, deal, e.target.value)} className="input text-xs" aria-label={`Stage of ${label(c)}`}>
                      {Object.entries(STAGES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  ) : c.lead_status in LEAD_STATUS ? (
                    <span className={`chip ${LEAD_CHIP[c.lead_status]}`}>{LEAD_STATUS[c.lead_status]}</span>
                  ) : (
                    ""
                  )}
                </td>
                <td>{c.bookings ?? ""}</td>
                <td>{full(c.last_booking)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One column per stage; drag a deal to move it, or use the picker on the card (touch has no drag). */
function DealBoard({ rows, onOpen, onDeal, setError }) {
  const [over, setOver] = useState(null);
  const today = formatDateISO(new Date());
  const deals = useMemo(() => rows.flatMap((c) => c.deals.map((d) => ({ ...d, contact: c }))), [rows]);

  async function move(deal, stage) {
    if (!deal || deal.stage === stage) return;
    const before = deal;
    const { contact, ...plain } = deal;
    onDeal(contact.id, { ...plain, stage });
    setError("");
    try {
      const r = await api("PATCH", { deal_id: deal.id, stage });
      onDeal(contact.id, r.deal);
    } catch (e) {
      const { contact: _c, ...old } = before;
      onDeal(contact.id, old);
      setError(e.message);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" style={{ height: PANE_HEIGHT, minHeight: "24rem" }}>
      {Object.entries(STAGES).map(([stage, title]) => {
        const cards = deals.filter((d) => d.stage === stage);
        return (
          <div
            key={stage}
            className={`card flex min-w-64 flex-1 flex-col ${over === stage ? "outline outline-2 outline-[var(--accent)]" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(stage);
            }}
            onDragLeave={() => setOver((o) => (o === stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = Number(e.dataTransfer.getData("text/plain"));
              move(deals.find((d) => d.id === id), stage);
            }}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-sm">
              <span className="text-ink">{title}</span>
              <span className={`chip ${STAGE_CHIP[stage]}`}>{cards.length}</span>
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {cards.length === 0 && <li className="px-1 text-xs muted">None</li>}
              {cards.map((d) => {
                const late = d.next_follow_up && d.next_follow_up < today && (d.stage === "demo" || d.stage === "link_sent");
                return (
                  <li
                    key={d.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", String(d.id))}
                    className="cursor-grab rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-sm hover:bg-[var(--surface-2)]"
                  >
                    <button type="button" className="block w-full text-left" onClick={() => onOpen(d.contact.id)}>
                      <span className="block truncate text-ink">{label(d.contact)}</span>
                      {place(d.contact) && <span className="block truncate text-xs muted">{place(d.contact)}</span>}
                      {d.next_follow_up && (
                        <span className={`block text-xs ${late ? "text-[var(--danger)]" : "muted"}`}>
                          Follow up {day(d.next_follow_up)}
                          {late ? ", overdue" : ""}
                        </span>
                      )}
                    </button>
                    <span className="mt-1 block">
                      <Select value={d.stage} onChange={(e) => move(d, e.target.value)} className="input text-xs" aria-label={`Stage of ${label(d.contact)}`}>
                        {Object.entries(STAGES).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A text box saved on leaving it, only if it was changed. */
function Field({ label: text, value, onSave, width, numeric, area }) {
  const [v, setV] = useState(value ?? "");
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setV(value ?? "");
  }, [value, edited]);
  const props = {
    className: "input w-full text-sm",
    value: v,
    onChange: (e) => {
      setV(e.target.value);
      setEdited(true);
    },
    onBlur: async () => {
      if (!edited) return;
      if (String(v) !== String(value ?? "")) await onSave(v);
      setEdited(false);
    },
  };
  return (
    <label className="block text-xs muted" style={width ? { maxWidth: width } : undefined}>
      {text}
      {area ? <textarea rows={3} {...props} /> : <input inputMode={numeric ? "numeric" : undefined} {...props} />}
    </label>
  );
}

function ContactPanel({ contact, hotels, onContact, onDeal, onChat, onGone, onClose }) {
  const dialog = useDialog();
  const [error, setError] = useState("");
  useEscape(onClose);

  async function run(fn) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  }

  const saveContact = (changes) =>
    run(async () => {
      const r = await api("PATCH", { contact_id: contact.id, ...changes });
      onContact(contact.id, r.contact);
    });
  const saveDeal = (deal, changes) =>
    run(async () => {
      const r = await api("PATCH", { deal_id: deal.id, ...changes });
      onDeal(contact.id, r.deal);
    });
  const addDeal = () =>
    run(async () => {
      const r = await api("POST", { contact_id: contact.id });
      onDeal(contact.id, r.deal);
    });
  const removeDeal = (deal) =>
    run(async () => {
      const ok = await dialog.confirm({ title: "Delete this deal?", message: "The contact stays.", confirmLabel: "Delete deal", danger: true });
      if (!ok) return;
      await api("DELETE", null, `?deal_id=${deal.id}`);
      onGone();
    });
  const removeContact = () =>
    run(async () => {
      const ok = await dialog.confirm({
        title: "Delete this contact?",
        message: "The contact and all of their deals are removed. The WhatsApp chat stays.",
        confirmLabel: "Delete contact",
        danger: true,
      });
      if (!ok) return;
      await api("DELETE", null, `?contact_id=${contact.id}`);
      onGone();
    });

  return (
    <div onClick={onClose} className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={`Contact ${label(contact)}`}>
      <div className="side-panel flex flex-col" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent-strong)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>{label(contact)}</h3>
          <button type="button" className="head-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" value={contact.name} onSave={(v) => saveContact({ name: v })} />
              <Field label="Email" value={contact.email} onSave={(v) => saveContact({ email: v })} />
              <Field label="Hotel" value={contact.hotel_name} onSave={(v) => saveContact({ hotel_name: v })} />
              <Field label="City" value={contact.city} onSave={(v) => saveContact({ city: v })} />
              <Field label="Rooms" value={contact.rooms} numeric onSave={(v) => saveContact({ rooms: v })} />
              <Field label="OTAs now" value={contact.current_otas} onSave={(v) => saveContact({ current_otas: v })} />
              <div className="text-xs muted">
                Phone
                <div className="flex items-center gap-2 pt-1 text-sm text-ink">
                  {contact.phone ? `+${contact.phone}` : "None"}
                  {contact.phone && (
                    <button type="button" className="btn btn-ghost text-sm" onClick={() => onChat(contact.phone)}>
                      Open chat
                    </button>
                  )}
                </div>
              </div>
            </div>
            <Field label="Notes" value={contact.notes} area onSave={(v) => saveContact({ notes: v })} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm text-ink">Deals</h4>
              <button type="button" className="btn btn-secondary text-sm" onClick={addDeal}>
                Add deal
              </button>
            </div>
            {contact.deals.length === 0 && <p className="text-xs muted">No deals yet.</p>}
            {contact.deals.map((d) => (
              <div key={d.id} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={d.stage} onChange={(e) => saveDeal(d, { stage: e.target.value })} className="input text-sm" aria-label="Stage">
                    {Object.entries(STAGES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-1 text-xs muted">
                    Follow up
                    <DateField
                      value={d.next_follow_up || ""}
                      onChange={(e) => saveDeal(d, { next_follow_up: e.target.value })}
                      className="input text-sm"
                      aria-label="Follow up date"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs muted">
                    Hotel
                    <Select
                      value={d.property_id || ""}
                      onChange={(e) => saveDeal(d, { property_id: e.target.value })}
                      className="input text-sm"
                      aria-label="Hotel signed up"
                    >
                      <option value="">Not signed up</option>
                      {hotels.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <Field label="Note" value={d.note} area onSave={(v) => saveDeal(d, { note: v })} />
                <button type="button" className="btn btn-ghost text-sm" onClick={() => removeDeal(d)}>
                  Delete deal
                </button>
              </div>
            ))}
          </section>

          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <button type="button" className="btn btn-ghost text-sm" onClick={removeContact}>
            Delete contact
          </button>
        </div>
      </div>
    </div>
  );
}
