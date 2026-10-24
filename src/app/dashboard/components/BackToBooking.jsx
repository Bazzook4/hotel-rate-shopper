"use client";

import { useToast } from "@/app/components/Toast";
import { confirmDiscardChanges, useDialog } from "@/app/components/Dialog";
import { hasUnsavedGridEdits } from "./SetupGrid";

/**
 * The way back to a booking left to set something up. It sticks under the
 * menu, so scrolling down a setup page to add the plan never hides it, and
 * Not now can be undone: a new booking's typing lives only here.
 */
export default function BackToBooking({ back, onBack, onForget, onRestore }) {
  const toast = useToast();
  const dialog = useDialog();
  async function goBack() {
    if (hasUnsavedGridEdits() && !(await confirmDiscardChanges(dialog, "this page"))) return;
    onBack();
  }
  function notNow() {
    onForget();
    toast(back.reservationId ? "Booking put away." : "New booking put away.", {
      undo: () => onRestore(back),
    });
  }
  return (
    <div
      className="sticky top-[84px] z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: "var(--accent-soft)", border: "1px solid var(--border)" }}
    >
      <p className="min-w-0 flex-1 basis-full text-sm md:basis-auto" style={{ color: "var(--text)" }}>
        {back.label ? `The booking for ${back.label} is waiting.` : "Your booking is waiting."}
        <span className="hidden md:inline" style={{ color: "var(--text-muted)" }}>
          {" "}
          {back.reservationId ? "Save here first, then go back." : "Everything you typed is kept. Save here first, then go back."}
        </span>
      </p>
      <button type="button" className="btn btn-primary text-xs" onClick={goBack}>
        Back to the booking
      </button>
      <button type="button" className="btn btn-secondary text-xs" onClick={notNow}>
        Not now
      </button>
    </div>
  );
}
