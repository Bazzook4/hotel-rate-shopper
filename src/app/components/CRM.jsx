"use client";

import { useState } from "react";
import HotelUsage from "./HotelUsage";
import WhatsAppInbox from "./WhatsAppInbox";
import CrmDeals from "./CrmDeals";

/**
 * Super admin only: the CRM, as leads, contacts and deals.
 *
 * Leads is the WhatsApp inbox: every number that writes in is a lead worked
 * through New enquiry, Contacted or No contact. Once a lead has developed,
 * Convert makes a Contact (the person and their hotel) and a Deal, which
 * moves through Demo, Onboarding link sent, Won or Lost. Hotels is Usage &
 * follow up for hotels already signed up. The view last used comes back
 * next time.
 */

const VIEWS = [
  ["chats", "Leads"],
  ["contacts", "Contacts"],
  ["deals", "Deals"],
  ["hotels", "Hotels"],
];

export default function CRM() {
  const [view, setViewState] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("crmView") : null;
    return VIEWS.some(([id]) => id === saved) ? saved : "chats";
  });
  const [openDeal, setOpenDeal] = useState(null);
  const [openPhone, setOpenPhone] = useState(null);
  const setView = (id) => {
    setViewState(id);
    localStorage.setItem("crmView", id);
    if (id !== "deals") setOpenDeal(null);
    if (id !== "chats") setOpenPhone(null);
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
      {view === "chats" && (
        <WhatsAppInbox
          key={openPhone || "inbox"}
          initialPhone={openPhone}
          onConvert={(dealId) => {
            setOpenDeal(dealId);
            setViewState("deals");
            localStorage.setItem("crmView", "deals");
          }}
        />
      )}
      {(view === "contacts" || view === "deals") && (
        <CrmDeals
          key={view}
          view={view}
          openDealId={openDeal}
          onOpenChat={(phone) => {
            setOpenPhone(phone);
            setViewState("chats");
          }}
        />
      )}
    </div>
  );
}
