"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Facts, Fact } from "./Facts";
import Icon from "./Icon";
import Select from "./Select";
import { useEscape } from "./useEscape";
import { Chat, INTEREST, LEAD_CHIP, LEAD_STATUS, OPEN_LEAD, call } from "./WhatsAppInbox";

/**
 * Super admin only: the CRM's lead list. Every number that writes in on the
 * business WhatsApp and is not a hotel on our system is a lead (migration
 * 072), worked through New enquiry, Contacted, No contact, Won or Lost. The
 * status is set here or in the chat's head; replying by hand moves a new
 * lead to Contacted, and a lead we could not reach moves back to Contacted
 * when they write again. A lead opens in a side panel with its chat.
 */

const POLL_MS = 15000;

const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

export default function Leads() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [openPhone, setOpenPhone] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await call("GET"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const leads = useMemo(
    () => (data?.contacts || []).filter((c) => c.lead && !c.property_id),
    [data]
  );

  const counts = useMemo(() => {
    const n = { open: 0, all: leads.length };
    for (const k of Object.keys(LEAD_STATUS)) n[k] = 0;
    for (const c of leads) {
      n[c.lead.status] = (n[c.lead.status] || 0) + 1;
      if (OPEN_LEAD.includes(c.lead.status)) n.open += 1;
    }
    return n;
  }, [leads]);

  const shown = useMemo(() => {
    let rows = leads;
    if (filter === "open") rows = rows.filter((c) => OPEN_LEAD.includes(c.lead.status));
    else if (filter !== "all") rows = rows.filter((c) => c.lead.status === filter);
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((c) => {
      const words = [c.name, c.lead.hotel_name, c.lead.city].filter(Boolean).join(" ").toLowerCase();
      return words.includes(q) || (digits && c.phone.includes(digits));
    });
  }, [leads, filter, query]);

  if (error && !data) {
    return (
      <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]">{error}</div>
    );
  }
  if (!data) return <p className="sub">Loading...</p>;

  const patch = (c) => setData((d) => ({ ...d, contacts: d.contacts.map((x) => (x.phone === c.phone ? { ...x, ...c } : x)) }));
  const open = leads.find((c) => c.phone === openPhone);
  const pick = (key) => () => setFilter(key);
  const on = (key) => (filter === key ? "ok" : undefined);

  async function setStatus(c, status) {
    const before = c.lead;
    patch({ phone: c.phone, lead: { ...before, status } });
    try {
      const r = await call("PATCH", { lead_id: before.id, status });
      patch({ phone: c.phone, lead: r.lead });
    } catch (e) {
      patch({ phone: c.phone, lead: before });
      setError(e.message);
    }
  }

  return (
    <div className="space-y-2">
      {error && <div className="text-sm text-[var(--danger)]">{error}</div>}

      <div className="flex items-center justify-between gap-2 md:flex-wrap">
        <div className="min-w-0 flex-1 md:hidden">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show" className="input w-full text-sm">
            <option value="open">Open ({counts.open})</option>
            {Object.entries(LEAD_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v} ({counts[k]})
              </option>
            ))}
            <option value="all">All ({counts.all})</option>
          </Select>
        </div>
        <Facts className="max-md:hidden">
          <Fact label="Open" tone={on("open")} onClick={pick("open")}>{counts.open}</Fact>
          {Object.entries(LEAD_STATUS).map(([k, v]) => (
            <Fact key={k} label={v} tone={on(k) || (k === "new" && counts.new ? "warn" : undefined)} onClick={pick(k)}>
              {counts[k]}
            </Fact>
          ))}
          <Fact label="All" tone={on("all")} onClick={pick("all")}>{counts.all}</Fact>
        </Facts>
        <input
          className="input w-full text-sm md:w-64"
          type="search"
          placeholder="Search name, number, hotel, city"
          aria-label="Search leads"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && shown[0]) setOpenPhone(shown[0].phone);
          }}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="grid-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Lead</th>
              <th className="text-left max-md:hidden">Property</th>
              <th className="text-left max-md:hidden">Wants</th>
              <th className="text-left">Last message</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="sub">
                  {query.trim() ? `No lead matches "${query.trim()}".` : "No leads here."}
                </td>
              </tr>
            )}
            {shown.map((c) => {
              const l = c.lead;
              const place = [l.hotel_name, l.city, l.rooms != null ? `${l.rooms} rooms` : null].filter(Boolean).join(", ");
              return (
                <tr key={c.phone} className="cursor-pointer hover:bg-[var(--surface-2)]" onClick={() => setOpenPhone(c.phone)}>
                  <td>
                    <div className={`text-ink ${c.unread ? "font-semibold" : ""}`}>{c.name || `+${c.phone}`}</div>
                    <div className="text-xs muted">
                      {c.name ? `+${c.phone}, ` : ""}
                      from {l.source_page || "direct"}, {day(l.created_at)}
                    </div>
                  </td>
                  <td className="max-md:hidden">{place || "-"}</td>
                  <td className="max-md:hidden">{INTEREST[l.interest] || "-"}</td>
                  <td>
                    <div className="max-w-[16rem] truncate">{c.last?.body || ""}</div>
                    <div className="text-xs muted">
                      {day(c.last?.created_at)}
                      {c.unread > 0 && <span className="chip chip-warn ml-1">{c.unread}</span>}
                      {c.handoff_at && <span className="chip chip-warn ml-1">Needs you</span>}
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className={`chip ${LEAD_CHIP[l.status]} mr-2 max-md:hidden`}>{LEAD_STATUS[l.status]}</span>
                    <Select value={l.status} onChange={(e) => setStatus(c, e.target.value)} className="input text-sm" aria-label={`Status of ${c.name || c.phone}`}>
                      {Object.entries(LEAD_STATUS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <LeadPanel contact={open} data={data} onContact={patch} onSent={load} onClose={() => setOpenPhone(null)} />
      )}
    </div>
  );
}

function LeadPanel({ contact, data, onContact, onSent, onClose }) {
  useEscape(onClose);
  return (
    <div onClick={onClose} className="side-panel-backdrop" role="dialog" aria-modal="true" aria-label={`Lead ${contact.name || contact.phone}`}>
      <div className="side-panel flex flex-col" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div
          className="side-panel-head flex items-center justify-between gap-3"
          style={{ padding: "0.85rem 1.1rem", background: "var(--accent-strong)", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}
        >
          <h3>Lead: {contact.name || `+${contact.phone}`}</h3>
          <button type="button" className="head-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Chat
            panel
            contact={contact}
            hotels={data.hotels}
            templates={data.templates}
            ready={data.ready}
            ai={data.ai}
            hotelName={null}
            onContact={onContact}
            onSent={onSent}
            onBack={onClose}
          />
        </div>
      </div>
    </div>
  );
}
