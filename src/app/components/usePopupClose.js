"use client";

import { useEffect, useRef } from "react";

/**
 * When a popup (a list, a calendar) closes on its own: a press outside it,
 * the page scrolling under it, the window resizing.
 *
 * Shared by Select, DatePicker and Dropdown so they all behave alike:
 *
 * - A press outside closes it and eats the click that follows, as a native
 *   select does, so one click does not also dismiss the dialog behind.
 * - On a phone the keyboard coming up scrolls (iOS) or resizes (Android)
 *   the page. That is not the desk leaving, so scroll and resize are
 *   ignored just after opening and while a text box inside has focus.
 *
 *   usePopupClose(isOpen, [buttonRef, panelRef], close);
 */
export default function usePopupClose(active, refs, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!active) return undefined;
    const opened = Date.now();
    const inside = (t) => t instanceof Node && refsRef.current.some((r) => r.current?.contains(t));
    const typing = () => {
      const a = document.activeElement;
      return a?.tagName === "INPUT" && inside(a);
    };
    const settling = () => Date.now() - opened < 500 || typing();

    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const down = (e) => {
      if (inside(e.target)) return;
      window.addEventListener("click", swallow, { capture: true, once: true });
      // A press that never becomes a click (a drag) must not eat a later one.
      setTimeout(() => window.removeEventListener("click", swallow, true), 1000);
      closeRef.current();
    };
    const scroll = (e) => {
      if (inside(e.target) || settling()) return;
      closeRef.current();
    };
    const resize = () => {
      if (!settling()) closeRef.current();
    };

    document.addEventListener("mousedown", down);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [active]);
}

/** A phone or tablet: a finger, not a mouse. */
export function isTouch() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

/**
 * Where a popup of about `height` px goes against `r` (the element it
 * opens from): below if it fits, else above if there is more room there,
 * with a max height that keeps it on screen either way.
 */
export function placeBelowOrAbove(r, height) {
  const below = window.innerHeight - r.bottom - 12;
  const above = r.top - 12;
  if (below >= height || below >= above) return { top: r.bottom + 4, maxHeight: Math.max(120, below) };
  return { bottom: window.innerHeight - r.top + 4, maxHeight: Math.max(120, above) };
}
