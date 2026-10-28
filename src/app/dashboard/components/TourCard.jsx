"use client";

import { useEffect, useState } from "react";
import Icon from "../../components/Icon";

/**
 * What the tours share: the card in the corner that holds a tip, and the
 * pointer that rings the thing the tip is about (src/lib/tours.js says
 * how a tip names it).
 */

const TEXT_TARGETS = 'button, [role="tab"], a, h2, h3, h4';

function visible(el) {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/** The first thing on screen a spec names, or null. */
export function findTarget(spec) {
  if (spec.startsWith("tour:")) {
    const all = [...document.querySelectorAll(`[data-tour="${spec.slice(5)}"]`)];
    return all.find(visible) || null;
  }
  const exact = spec.startsWith("exact:");
  if (exact || spec.startsWith("text:")) {
    const want = spec.slice(spec.indexOf(":") + 1).toLowerCase();
    const all = [...document.querySelectorAll(TEXT_TARGETS)].filter(
      (el) => visible(el) && !el.closest("[data-tour-card]")
    );
    const words = (el) => el.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    return (
      all.find((el) => words(el) === want) ||
      (exact ? null : all.find((el) => words(el).startsWith(want))) ||
      null
    );
  }
  return null;
}

/**
 * Rings the first of `points` on screen and scrolls to it, waiting up to
 * five seconds for the page to load and draw it. The keyboard stays where
 * it was: on a Check in button, a stray Enter would check a guest in.
 * Answers whether it found one: null while looking, then true or false.
 */
export function usePointAt(points) {
  const key = points.join("|");
  const [found, setFound] = useState(null);
  useEffect(() => {
    setFound(key ? null : false);
    if (!key) return;
    let el = null;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      el = key.split("|").map(findTarget).find(Boolean) || null;
      if (el || tries > 50) {
        clearInterval(timer);
        setFound(Boolean(el));
      }
      if (!el) return;
      el.classList.add("tour-focus");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 100);
    return () => {
      clearInterval(timer);
      el?.classList.remove("tour-focus");
    };
  }, [key]);
  return found;
}

/** Calls `onSeen` once the spec appears on screen: the desk did the step. */
export function useWaitFor(spec, onSeen) {
  useEffect(() => {
    if (!spec) return;
    const timer = setInterval(() => {
      if (findTarget(spec)) {
        clearInterval(timer);
        onSeen();
      }
    }, 300);
    return () => clearInterval(timer);
    // onSeen changes every render; the spec alone decides when to look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);
}

/** The tour's card, bottom left, over everything but confirm boxes. */
export function CoachCard({ title, counter, label = "Tour", onSkip, skipLabel = "Skip tour", children }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      data-tour-card
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
        <button type="button" className="btn btn-ghost min-h-[32px] px-2.5 py-1 text-xs" onClick={onSkip}>
          {skipLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

/** Back and Next (Finish on the last tip). */
export function StepButtons({ step, total, onBack, onNext }) {
  // A one-tip tour has nothing to step through: Close in the header ends it.
  if (total < 2) return null;
  return (
    <div className="flex justify-end gap-2">
      {step > 0 && (
        <button type="button" className="btn btn-ghost text-sm" onClick={onBack}>
          Back
        </button>
      )}
      <button type="button" className="btn btn-primary text-sm" onClick={onNext}>
        {step < total - 1 ? "Next" : "Finish"}
      </button>
    </div>
  );
}
