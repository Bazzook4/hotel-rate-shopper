"use client";

import { useEffect, useRef, useState } from "react";
import { useEscape } from "../../components/useEscape";
import { TOURS, findTours } from "@/lib/tours";
import { track } from "@/lib/track";
import { CoachCard, StepButtons, usePointAt, useWaitFor } from "./TourCard";

/**
 * Show me how: the desk asks how to do a job and is walked through it on
 * the real page (src/lib/tours.js). Opened from the bar along the bottom,
 * next to Help, so it is there on every page without covering any of it.
 *
 * Only jobs on pages the reader can open are offered. Practice tours run
 * on a practice booking, which the dashboard opens (`onStartPractice`);
 * every other tour opens its page and walks it here.
 */

/** The tour on its page: one tip at a time, following the desk's clicks. */
function PageTour({ tour, onEnd }) {
  const [step, setStep] = useState(0);
  const current = tour.steps[step];
  const total = tour.steps.length;
  const found = usePointAt(current.point);
  // Off after Back: the step's waitFor is often still on screen, and would
  // move straight on again.
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    track("tour", { target: tour.id });
  }, [tour.id]);
  const quit = () => {
    track("tour_quit", { target: tour.id, value: step + 1 });
    onEnd();
  };
  const next = () => {
    setFollow(true);
    if (step < total - 1) setStep(step + 1);
    else {
      track("tour_done", { target: tour.id });
      onEnd();
    }
  };
  const back = () => {
    setFollow(false);
    setStep(step - 1);
  };
  useWaitFor(follow ? current.waitFor : null, next);
  useEscape(quit);

  return (
    <CoachCard
      title={tour.title}
      label={tour.title}
      counter={total > 1 ? `${step + 1} of ${total}` : null}
      onSkip={quit}
      skipLabel="Close"
    >
      <p className="text-sm" style={{ color: "var(--text)" }}>
        {found === false && current.none ? current.none : current.text}
      </p>
      <StepButtons step={step} total={total} onBack={back} onNext={next} />
    </CoachCard>
  );
}

/** "What do you want to learn?": a search over the jobs this reader can do. */
function Picker({ tours, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const found = findTours(tours, query);
  useEscape(onClose);

  // Back to whatever had the keyboard, the Show me how button as a rule.
  useEffect(() => {
    const before = document.activeElement;
    return () => before?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    // Ready to type on a laptop; a phone would throw its keyboard up.
    if (window.matchMedia("(pointer: fine)").matches) box.current?.focus();
  }, []);

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 55 }} onClick={onClose} />
      <div
        role="dialog"
        aria-label="Show me how"
        className="card fixed bottom-[42px] left-3 right-3 space-y-2 p-3 md:left-auto md:w-[340px]"
        style={{ zIndex: 56, boxShadow: "0 8px 30px rgba(0,0,0,0.18)" }}
      >
        <input
          ref={box}
          type="search"
          className="input w-full"
          placeholder="What do you want to learn?"
          aria-label="Search the guides"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.max(0, Math.min(i + 1, found.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && found[active]) {
              onPick(found[active]);
            }
          }}
        />
        <ul className="max-h-[45vh] space-y-1 overflow-y-auto" role="listbox" aria-label="Guides">
          {found.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className="btn btn-ghost w-full justify-between py-1 text-sm"
                style={i === active ? { borderColor: "var(--accent)" } : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(t)}
              >
                <span>{t.title}</span>
                {t.practice && (
                  <span className="sub text-xs">practice</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {!found.length && (
          <p className="sub">
            No guide for that yet. Ask us with Help on WhatsApp, below.
          </p>
        )}
      </div>
    </>
  );
}

export default function TourGuide({ open, onClose, canOpen, openPage, onStartPractice }) {
  const [tour, setTour] = useState(null);
  const tours = TOURS.filter((t) => canOpen(t.page));

  function pick(t) {
    onClose();
    if (t.practice) {
      setTour(null);
      onStartPractice(t);
      return;
    }
    openPage(t.page, t.view || null);
    setTour(t);
  }

  return (
    <>
      {open && <Picker tours={tours} onPick={pick} onClose={onClose} />}
      {/* Keyed so picking the same job again starts it from the top. */}
      {tour && <PageTour key={tour.id} tour={tour} onEnd={() => setTour(null)} />}
    </>
  );
}

/** Whether this reader has any guide to be offered. */
export function hasTours(canOpen) {
  return TOURS.some((t) => canOpen(t.page));
}
