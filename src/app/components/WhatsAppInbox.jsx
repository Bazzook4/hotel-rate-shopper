"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Facts, Fact } from "./Facts";
import Icon from "./Icon";
import Select from "./Select";

/**
 * Super admin only: the business WhatsApp number's inbox (migration 064).
 * Chats on the left, newest first with unread counts and a search; the open
 * chat on the right with the lead's status and the bot switch in its head,
 * a reply box, and the lead's details and hotel link below. For a hotel's
 * contact, the daily report switch.
 *
 * Chats the AI assistant handed over (migration 065) sit at the top as
 * "Needs you" until answered. With the assistant on, "Suggest reply" drafts
 * an answer to edit and send.
 *
 * A free reply reaches them only within 24 hours of their last message;
 * after that the box gives way to an approved template. New messages are
 * checked every 15 seconds while the tab is open.
 */

const POLL_MS = 15000;
const LEAD_STATUS = { new: "New", contacted: "Contacted", won: "Won", lost: "Lost" };
const INTEREST = {
  ota_listing: "OTA listing",
  pms: "Free PMS",
  ota_audit: "OTA audit",
  revenue: "Revenue",
  website: "Website",
  other: "Other",
};
const TICK = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" };
const PANE_HEIGHT = "calc(100dvh - 15rem)";

const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const needsYou = (c) => Boolean(c.handoff_at);
const openLead = (c) => c.lead && !c.property_id && ["new", "contacted"].includes(c.lead.status);

async function call(method, body, query = "") {
  const r = await fetch(`/api/admin/whatsapp${query}`, {
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

export default function WhatsAppInbox() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState(null);
  const [query, setQuery] = useState("");
  const [openPhone, setOpenPhone] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await call("GET"));
      setLoadError("");
    } catch (e) {
      if (e.missing) setMissing(true);
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Chats waiting on you first, then newest.
  const contacts = useMemo(
    () => [...(data?.contacts || [])].sort((a, b) => Number(needsYou(b)) - Number(needsYou(a))),
    [data]
  );
  const hotelName = useMemo(() => new Map((data?.hotels || []).map((h) => [h.id, h.name])), [data]);

  const counts = useMemo(
    () => ({
      unread: contacts.filter((c) => c.unread > 0).length,
      needs: contacts.filter(needsYou).length,
      leads: contacts.filter(openLead).length,
      hotels: contacts.filter((c) => c.property_id).length,
      paused: contacts.filter((c) => c.bot_paused && !c.property_id).length,
    }),
    [contacts]
  );

  const shown = useMemo(() => {
    let rows = contacts;
    if (filter === "unread") rows = rows.filter((c) => c.unread > 0);
    if (filter === "needs") rows = rows.filter(needsYou);
    if (filter === "leads") rows = rows.filter(openLead);
    if (filter === "hotels") rows = rows.filter((c) => c.property_id);
    if (filter === "paused") rows = rows.filter((c) => c.bot_paused && !c.property_id);
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((c) => {
      const words = [c.name, hotelName.get(c.property_id), c.lead?.hotel_name, c.lead?.city].filter(Boolean).join(" ").toLowerCase();
      return words.includes(q) || (digits.length >= 3 && c.phone.includes(digits));
    });
  }, [contacts, filter, query, hotelName]);

  if (missing) {
    return (
      <div className="rounded-xl border border-[var(--warn)] px-4 py-2 text-sm" style={{ color: "var(--warn)" }}>
        WhatsApp is not switched on yet: run migration 064.
      </div>
    );
  }
  if (loadError && !data) {
    return (
      <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]">
        {loadError}
      </div>
    );
  }
  if (!data) return <p className="sub">Loading...</p>;

  const pick = (key) => () => setFilter((f) => (f === key || key === "all" ? null : key));
  const on = (key) => (filter === key ? "ok" : undefined);
  const open = contacts.find((c) => c.phone === openPhone);
  const patchContact = (c) => setData((d) => ({ ...d, contacts: d.contacts.map((x) => (x.phone === c.phone ? { ...x, ...c } : x)) }));
  const notice = !data.ready
    ? "WhatsApp is not connected, so nothing can be sent: set WA_TOKEN and WA_PHONE_NUMBER_ID in Vercel."
    : loadError;

  // Picking a hotel adds its contact straight away and opens the chat.
  async function add(propertyId) {
    if (!propertyId || adding) return;
    setAdding(true);
    setAddError("");
    try {
      const { contact } = await call("POST", { add_property_id: propertyId });
      await load();
      setOpenPhone(contact.phone);
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-2">
      {notice && (
        <div className="rounded-xl border border-[var(--warn)] px-4 py-2 text-sm" style={{ color: "var(--warn)" }}>
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Facts>
          <Fact label="Chats" onClick={pick("all")}>{contacts.length}</Fact>
          <Fact label="Needs you" tone={on("needs") || (counts.needs ? "warn" : undefined)} onClick={pick("needs")}>{counts.needs}</Fact>
          <Fact label="Unread" tone={on("unread") || (counts.unread ? "warn" : undefined)} onClick={pick("unread")}>{counts.unread}</Fact>
          <Fact label="Open leads" tone={on("leads")} onClick={pick("leads")}>{counts.leads}</Fact>
          <Fact label="Bot off" tone={on("paused")} onClick={pick("paused")}>{counts.paused}</Fact>
          <Fact label="Hotels" tone={on("hotels")} onClick={pick("hotels")}>{counts.hotels}</Fact>
        </Facts>
        <div className="flex items-center gap-2">
          {addError && <span className="text-xs text-[var(--danger)]">{addError}</span>}
          <Select value="" onChange={(e) => add(e.target.value)} disabled={adding} aria-label="Add a hotel's contact" className="input text-sm">
            <option value="">{adding ? "Adding..." : "Add a hotel's contact..."}</option>
            {data.hotels.map((h) => (
              <option key={h.id} value={h.has_mobile ? h.id : ""}>
                {h.has_mobile ? h.name : `${h.name} (no mobile)`}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
        <div className={`card flex flex-col overflow-hidden ${open ? "hidden md:flex" : ""}`} style={{ height: PANE_HEIGHT, minHeight: "24rem" }}>
          <div className="border-b border-[var(--border)] p-2">
            <input
              className="input w-full text-sm"
              type="search"
              placeholder="Search name, number, hotel, city"
              aria-label="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && shown[0]) setOpenPhone(shown[0].phone);
              }}
            />
          </div>
          {shown.length === 0 && (
            <p className="card-pad sub text-sm">{query.trim() ? `No chat matches "${query.trim()}".` : "No chats here."}</p>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.phone}>
                <button
                  type="button"
                  onClick={() => setOpenPhone(c.phone)}
                  aria-current={c.phone === openPhone}
                  className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left text-sm ${
                    c.phone === openPhone ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-ink ${c.unread ? "font-semibold" : ""}`}>{c.name || `+${c.phone}`}</span>
                    <span className="shrink-0 text-xs muted">{when(c.last?.created_at)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs muted">
                      {c.property_id ? hotelName.get(c.property_id) : c.last?.body || ""}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {needsYou(c) ? (
                        <span className="chip chip-warn">Needs you</span>
                      ) : (
                        c.bot_paused && !c.property_id && <span className="chip chip-off">Bot off</span>
                      )}
                      {c.lead && !c.property_id && (
                        <span className={`chip ${c.lead.status === "won" ? "chip-ok" : c.lead.status === "lost" ? "chip-off" : "chip-booked"}`}>
                          {LEAD_STATUS[c.lead.status]}
                        </span>
                      )}
                      {c.unread > 0 && <span className="chip chip-warn">{c.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {open ? (
          <Chat
            key={open.phone}
            contact={open}
            hotels={data.hotels}
            templates={data.templates}
            ready={data.ready}
            ai={data.ai}
            hotelName={hotelName.get(open.property_id)}
            onContact={patchContact}
            onSent={load}
            onBack={() => setOpenPhone(null)}
          />
        ) : (
          <div className="card card-pad hidden text-sm sub md:block">Pick a chat to read and reply.</div>
        )}
      </div>
    </div>
  );
}

function Chat({ contact, hotels, templates, ready, ai, hotelName, onContact, onSent, onBack }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [params, setParams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [details, setDetails] = useState(false);
  const box = useRef(null);
  const reply = useRef(null);
  const firstBlank = useRef(null);
  const lastAt = contact.last?.created_at;
  const lead = contact.lead && !contact.property_id ? contact.lead : null;

  const loadThread = useCallback(async () => {
    try {
      setMessages((await call("GET", null, `?phone=${contact.phone}`)).messages);
      onContact({ phone: contact.phone, unread: 0 });
    } catch (e) {
      setError(e.message);
    }
    // onContact is a fresh function each render; the thread only depends on the phone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.phone]);

  // Again whenever the list sees a newer message in this chat.
  useEffect(() => {
    loadThread();
  }, [loadThread, lastAt]);

  // Follow new messages only when already at the bottom, inside the thread alone.
  const atBottom = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // The cursor goes where the next thing is typed, but not on a phone,
  // where it would pop the keyboard over the chat.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches && contact.in_window) reply.current?.focus();
  }, [contact.in_window]);

  useEffect(() => {
    if (template) firstBlank.current?.focus();
  }, [template]);

  const first = contact.name ? contact.name.split(" ")[0] : "";
  function chooseTemplate(name) {
    setTemplate(name);
    const blanks = templates[name]?.params || [];
    setParams(blanks.map((label) => (label === "Name" ? first : label === "Hotel" ? hotelName || contact.lead?.hotel_name || "" : "")));
  }

  const canText = !busy && ready && text.trim();
  const canTemplate = !busy && ready && template && params.every((p) => p.trim());

  async function send(body) {
    setBusy(true);
    setError("");
    try {
      await call("POST", { phone: contact.phone, ...body });
      setText("");
      setTemplate("");
      atBottom.current = true;
      await loadThread();
      onSent();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setDrafting(true);
    setError("");
    try {
      const r = await fetch("/api/admin/whatsapp/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: contact.phone }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not draft a reply");
      setText(j.draft);
      reply.current?.focus();
    } catch (e) {
      setError(e.message);
    } finally {
      setDrafting(false);
    }
  }

  const done = (msg) => {
    setSaved(msg);
    setTimeout(() => setSaved(""), 3000);
  };

  async function change(body, msg = "Saved") {
    setError("");
    try {
      const { contact: c } = await call("PATCH", { phone: contact.phone, ...body });
      onContact(c);
      done(body.property_id === null && contact.opted_in ? "Unlinked, daily report turned off" : msg);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveLead(changes) {
    setError("");
    try {
      const r = await call("PATCH", { lead_id: contact.lead.id, ...changes });
      onContact({ phone: contact.phone, lead: r.lead });
      done("Saved");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    // On a phone the open chat takes the whole screen, as WhatsApp does.
    <div className="card flex flex-col max-md:fixed max-md:inset-0 max-md:z-50 max-md:h-dvh max-md:rounded-none md:h-[calc(100dvh-15rem)] md:min-h-96">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" className="btn btn-ghost text-sm md:hidden" onClick={onBack} aria-label="Back to chats">
            <Icon name="back" size={16} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-ink">{contact.name || `+${contact.phone}`}</div>
            <div className="truncate text-xs muted">
              +{contact.phone}
              {hotelName ? `, ${hotelName}` : ""}
              {lead ? `, from ${lead.source_page || "direct"}` : ""}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" className="btn btn-ghost text-sm md:hidden" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            Details
          </button>
          {lead && (
            <span className="hidden md:block">
              <LeadStatus lead={lead} onSave={saveLead} />
            </span>
          )}
          {!contact.property_id && (
            <label className="flex items-center gap-2 text-sm" title="When off, you answer this chat yourself">
              <input
                type="checkbox"
                checked={!contact.bot_paused}
                onChange={(e) => change({ bot_paused: !e.target.checked }, e.target.checked ? "Bot is answering" : "You are answering")}
              />
              <span className="max-md:hidden">Bot replies</span>
              <span className="md:hidden">Bot</span>
            </label>
          )}
        </div>
      </div>

      {needsYou(contact) && (
        <div className="border-b border-[var(--border)] px-3 py-1.5 text-sm max-md:line-clamp-2" style={{ color: "var(--warn)" }}>
          Needs you: {contact.handoff_reason || "the assistant handed this chat over"}. Reply, or turn the bot back on.
        </div>
      )}

      <div
        ref={box}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!messages && <p className="sub text-sm">Loading...</p>}
        {messages?.length === 0 && <p className="sub text-sm">No messages yet.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[80%] rounded-xl px-3 py-1.5 text-sm"
              style={{
                background: m.direction === "out" ? "var(--accent-soft)" : "var(--surface-2)",
                border: m.status === "failed" ? "1px solid var(--danger)" : undefined,
              }}
            >
              <span className="whitespace-pre-wrap text-ink">{m.body}</span>
              <span className="float-right ml-2 mt-1 text-xs muted">
                {when(m.created_at)}
                {m.direction === "out" && ` ${TICK[m.status] || ""}`}
                {m.direction === "out" &&
                  (!m.sent_by ? " (bot)" : m.sent_by === "ai" ? " (AI)" : m.sent_by.includes("@") ? "" : ` (${m.sent_by})`)}
              </span>
              {m.error && <div className="clear-both text-xs text-[var(--danger)]">{m.error}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2">
        {contact.in_window ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canText) send({ text });
            }}
          >
            <textarea
              ref={reply}
              className="input w-full"
              rows={2}
              style={{ resize: "vertical" }}
              placeholder="Type a reply (Shift+Enter for a new line)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canText) send({ text });
                }
              }}
            />
            <div className="flex flex-col gap-1">
              {ai && (
                <button type="button" className="btn btn-ghost text-sm" disabled={drafting || busy} onClick={suggest}>
                  {drafting ? "Drafting..." : "Suggest reply"}
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={!canText}>
                Send
              </button>
            </div>
          </form>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            title="Their last message was over 24 hours ago, so only an approved template can be sent."
            onSubmit={(e) => {
              e.preventDefault();
              if (canTemplate) send({ template, params });
            }}
          >
            <span className="text-xs muted">Over 24 hours, template only:</span>
            <Select value={template} onChange={(e) => chooseTemplate(e.target.value)} aria-label="Template" className="input text-sm">
              <option value="">Pick a template...</option>
              {Object.entries(templates).map(([name, t]) => (
                <option key={name} value={name}>
                  {t.label}
                </option>
              ))}
            </Select>
            {template &&
              templates[template].params.map((label, i) => (
                <input
                  key={label}
                  ref={i === 0 ? firstBlank : undefined}
                  className="input text-sm"
                  style={{ width: "11rem" }}
                  placeholder={label}
                  aria-label={label}
                  value={params[i] || ""}
                  onChange={(e) => setParams((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
                />
              ))}
            {template && (
              <button type="submit" className="btn btn-primary text-sm" disabled={!canTemplate}>
                Send template
              </button>
            )}
          </form>
        )}
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>

      {/* On a phone the details stay folded behind the Details button, so the messages get the screen. */}
      <div
        className={`${details ? "flex" : "hidden"} max-h-[45dvh] flex-wrap items-center gap-x-3 gap-y-2 overflow-y-auto border-t border-[var(--border)] px-3 py-2 text-xs muted md:flex md:max-h-none`}
      >
        {lead && (
          <>
            <span className="md:hidden">
              <LeadStatus lead={lead} onSave={saveLead} />
            </span>
            <label className="flex items-center gap-1">
              Wants
              <Select value={lead.interest || ""} onChange={(e) => saveLead({ interest: e.target.value })} className="input text-sm" aria-label="Wants">
                <option value="">Not said</option>
                {Object.entries(INTEREST).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </label>
            <LeadField lead={lead} name="hotel_name" label="Property" width="10rem" onSave={saveLead} />
            <LeadField lead={lead} name="city" label="City" width="7rem" onSave={saveLead} />
            <LeadField lead={lead} name="rooms" label="Rooms" width="3.5rem" numeric onSave={saveLead} />
            <LeadField lead={lead} name="current_otas" label="OTAs now" width="10rem" onSave={saveLead} />
          </>
        )}
        <label className="flex items-center gap-1">
          Hotel
          <Select
            value={contact.property_id || ""}
            onChange={(e) => change({ property_id: e.target.value || null })}
            className="input text-sm"
            aria-label="Linked hotel"
          >
            <option value="">Not a hotel yet</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </label>
        {contact.property_id && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={contact.opted_in}
              onChange={(e) => change({ opted_in: e.target.checked }, e.target.checked ? "Daily report on" : "Daily report off")}
            />
            Daily report at 8 AM
          </label>
        )}
        {saved && <span role="status">{saved}</span>}
      </div>
    </div>
  );
}

function LeadStatus({ lead, onSave }) {
  return (
    <Select value={lead.status} onChange={(e) => onSave({ status: e.target.value })} className="input text-sm" aria-label="Lead status">
      {Object.entries(LEAD_STATUS).map(([k, v]) => (
        <option key={k} value={k}>
          Lead: {v}
        </option>
      ))}
    </Select>
  );
}

/**
 * One lead detail, saved on leaving the box only if it was typed in, so a
 * box opened before the bot filled it in cannot wipe what the bot saved.
 */
function LeadField({ lead, name, label, width, numeric, onSave }) {
  const [value, setValue] = useState(lead[name] ?? "");
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (!edited) setValue(lead[name] ?? "");
  }, [lead, name, edited]);

  return (
    <label className="flex items-center gap-1">
      {label}
      <input
        className="input text-sm"
        style={{ width }}
        value={value}
        inputMode={numeric ? "numeric" : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setEdited(true);
        }}
        onBlur={async () => {
          if (!edited) return;
          if (String(value) !== String(lead[name] ?? "")) await onSave({ [name]: value });
          setEdited(false);
        }}
      />
    </label>
  );
}
