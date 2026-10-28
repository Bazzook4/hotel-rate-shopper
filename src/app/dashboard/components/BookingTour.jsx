"use client";

import { useEffect, useState } from "react";
import BookingModal from "./BookingModal";
import Icon from "../../components/Icon";
import { PageNavProvider } from "../../components/PageNav";
import { useDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useEscape } from "../../components/useEscape";
import { formatMoney } from "@/lib/money";

/**
 * The booking tour: a practice booking on the real booking panel, a few
 * tips long, offered once to every new user and started again from Explore.
 *
 * It opens with a check of what the hotel gave at sign-up, for whoever
 * manages setup: a hotel that said 20 rooms but set up room types for 10
 * would sell only 10, so it is shown the gap and can add the rooms or
 * lower its total. Then the card walks the practice booking. Nothing in it
 * is ever saved: Create booking hands back to the tour.
 */

// Two tips, each on the field it talks about: dates and room explain
// themselves, so the tips cover what a new desk would not find alone.
const STEPS = [
  {
    id: "company",
    title: "Company or travel agent",
    text: "Pick dates and a room as usual. For a company or agent booking, set Booking method to Corporate or Travel agent and the form asks which one.",
    focus: ["company", "method"],
  },
  {
    id: "guest",
    title: "Guest and ID",
    text: "Each guest is saved under their phone number and comes up next time. Their ID photo is added at check-in.",
    focus: ["phone"],
  },
];

/** Points at the first of `names` on screen, waiting a moment for it to draw. */
function useFocus(names) {
  const key = names.join(",");
  useEffect(() => {
    if (!key) return;
    let el = null;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      el = key
        .split(",")
        .map((n) => document.querySelector(`[data-tour="${n}"]`))
        .find(Boolean);
      if (el || tries > 20) clearInterval(timer);
      if (!el) return;
      el.classList.add("tour-focus");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      // Keyboard users start where the tip points.
      el.querySelector("input, button, [tabindex]")?.focus({ preventScroll: true });
    }, 100);
    return () => {
      clearInterval(timer);
      el?.classList.remove("tour-focus");
    };
  }, [key]);
}

/** What the hotel gave at sign-up, and the rooms still to add. */
function RoomCheck({ propertyId, onNext, onAddRooms }) {
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/setup/roomCheck?propertyId=${propertyId || ""}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not check your rooms");
        if (!cancelled) setCheck(d);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [propertyId, attempt]);

  // Asked first: only Online Hotelier support can raise the total again.
  async function lowerTotal() {
    const yes = await dialog.confirm({
      title: `Change your total to ${check.setUp} rooms?`,
      message: `Raising it back to ${check.total} later needs Online Hotelier support.`,
      confirmLabel: `I have ${check.setUp} rooms`,
      cancelLabel: "Keep " + check.total,
    });
    if (!yes) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/setup/roomCheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not change your total");
      setCheck(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !check) {
    return (
      <>
        <p className="sub flex items-center gap-1.5" style={{ color: "var(--warn)" }}>
          <Icon name="warn" size={14} /> {error}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
          <button type="button" className="btn btn-primary text-sm" onClick={onNext}>
            Next
          </button>
        </div>
      </>
    );
  }
  if (!check) return <p className="sub">Checking your rooms...</p>;

  const short = check.missing > 0;
  return (
    <>
      <p className="text-sm" style={{ color: short ? "var(--warn)" : "var(--text)" }}>
        {short
          ? `You said ${check.total} rooms. Your room types add up to ${check.setUp}, so ${check.missing} are missing and cannot be sold.`
          : `All ${check.setUp} rooms are set up.`}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {check.roomTypes.map((rt) => (
            <tr key={rt.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="py-1">{rt.name}</td>
              <td className="py-1 text-right">{rt.rooms} rooms</td>
              <td className="py-1 text-right" style={{ color: "var(--text-muted)" }}>
                {rt.price > 0 ? `from ${formatMoney(rt.price)}` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {check.plans.length > 0 && (
        <p className="sub">Sold as: {check.plans.join(", ")}.</p>
      )}
      {error && (
        <p className="sub flex items-center gap-1.5" style={{ color: "var(--warn)" }}>
          <Icon name="warn" size={14} /> {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {short ? (
          <>
            {check.setUp > 0 && (
              <button type="button" className="btn btn-ghost text-sm" disabled={busy} onClick={lowerTotal}>
                {busy ? "Saving..." : `I have ${check.setUp} rooms`}
              </button>
            )}
            <button type="button" className="btn btn-primary text-sm" onClick={onAddRooms}>
              Add the other {check.missing}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary text-sm" onClick={onNext}>
            Looks right
          </button>
        )}
      </div>
    </>
  );
}

export default function BookingTour({ session, pageNav, onEnd }) {
  const withCheck = Boolean(session?.canManageSetup);
  // -1 is the room check.
  const [step, setStep] = useState(withCheck ? -1 : 0);
  const current = STEPS[step] || null;
  const toast = useToast();
  useFocus(current?.focus || []);
  // With the practice panel open, its own Escape closes it and ends the tour.
  useEscape(() => end(), !current);

  // Done for good: finished, skipped or closed. Saved quietly; a failure
  // only means the tour is offered again next time.
  function end(done = true) {
    if (done) fetch("/api/auth/tour", { method: "POST" }).catch(() => {});
    onEnd(done);
  }

  // Leaving the practice booking for a setup page ends the tour there,
  // rather than carrying practice typing into a real booking.
  const nav = {
    canOpen: pageNav.canOpen,
    openPage: (id) => {
      end();
      pageNav.openPage(id);
    },
    leaveFor: (id) => {
      end();
      pageNav.openPage(id);
    },
  };

  const title =
    step === -1 ? "Check your rooms" : current.title;
  const counter = step >= 0 ? `${step + 1} of ${STEPS.length}` : null;

  // The end of the tour is a note, not another card to close.
  function finish() {
    toast("Practice done, nothing was saved. Book for real from the Calendar.");
    end();
  }

  return (
    <>
      {step >= 0 && (
        <PageNavProvider value={nav}>
          <BookingModal
            session={session}
            prefill={{ guest_name: "Asha Rao (practice)" }}
            onClose={() => end()}
            onPracticeSaved={finish}
          />
        </PageNavProvider>
      )}

      <div
        role="dialog"
        aria-label="Booking tour"
        className="card fixed bottom-3 left-3 right-3 space-y-2 p-3 md:right-auto md:w-[380px]"
        style={{ zIndex: 60, boxShadow: "0 8px 30px rgba(0,0,0,0.18)", border: "2px solid var(--accent)" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent)" }}>
            <Icon name="compass" size={16} />
          </span>
          <h3 className="flex-1 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h3>
          {counter && <span className="sub text-xs">{counter}</span>}
          <button type="button" className="btn btn-ghost min-h-[32px] px-2.5 py-1 text-xs" onClick={() => end()}>
            Skip tour
          </button>
        </div>

        {step === -1 && (
          <RoomCheck
            propertyId={session?.propertyId}
            onNext={() => setStep(0)}
            onAddRooms={() => {
              // Not marked done: the tour comes back once the rooms are in.
              end(false);
              pageNav.openPage("rooms");
            }}
          />
        )}

        {current && (
          <>
            <p className="text-sm" style={{ color: "var(--text)" }}>
              {current.text}
            </p>
            <div className="flex justify-end gap-2">
              {step > 0 && (
                <button type="button" className="btn btn-ghost text-sm" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary text-sm"
                onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}
              >
                {step < STEPS.length - 1 ? "Next" : "Finish"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
