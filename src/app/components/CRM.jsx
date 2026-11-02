"use client";

import { useState } from "react";
import HotelUsage from "./HotelUsage";
import WhatsAppInbox from "./WhatsAppInbox";

/**
 * Super admin only: the CRM. Leads & chats is the WhatsApp inbox, where
 * every number that writes in is a lead worked through New enquiry,
 * Contacted, No contact, Won or Lost; Hotels is Usage & follow up for hotels
 * already signed up. The view last used comes back next time.
 */

const VIEWS = [
  ["chats", "Leads & chats"],
  ["hotels", "Hotels"],
];

export default function CRM() {
  const [view, setViewState] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("crmView") : null;
    return VIEWS.some(([id]) => id === saved) ? saved : "chats";
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
      {view === "hotels" && <HotelUsage />}
      {view === "chats" && <WhatsAppInbox />}
    </div>
  );
}
