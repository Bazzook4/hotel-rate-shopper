"use client";

import { useState } from "react";
import HotelUsage from "./HotelUsage";
import Leads from "./Leads";
import WhatsAppInbox from "./WhatsAppInbox";

/**
 * Super admin only: the CRM. Leads are people who wrote in on the business
 * WhatsApp; Hotels is Usage & follow up for hotels already signed up; Chats
 * is the full WhatsApp inbox. The view last used comes back next time.
 */

const VIEWS = [
  ["leads", "Leads"],
  ["hotels", "Hotels"],
  ["chats", "Chats"],
];

export default function CRM() {
  const [view, setViewState] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("crmView") : null;
    return VIEWS.some(([id]) => id === saved) ? saved : "leads";
  });
  const setView = (id) => {
    setViewState(id);
    localStorage.setItem("crmView", id);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            className={view === id ? "btn btn-secondary text-sm" : "btn btn-ghost text-sm"}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "leads" && <Leads />}
      {view === "hotels" && <HotelUsage />}
      {view === "chats" && <WhatsAppInbox />}
    </div>
  );
}
