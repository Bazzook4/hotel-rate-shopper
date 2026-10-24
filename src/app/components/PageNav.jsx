"use client";

import { createContext, useContext } from "react";

/**
 * Lets anything deep in a page open another page -- a hint that says what to
 * set up can take the hotelier there instead of naming the menu path.
 *
 * Outside the dashboard there is nothing to open, so `canOpen` says no and
 * callers fall back to plain text.
 */
const PageNavContext = createContext({ openPage: () => {}, leaveFor: () => {}, canOpen: () => false });

export const PageNavProvider = PageNavContext.Provider;

export function usePageNav() {
  return useContext(PageNavContext);
}

/**
 * A button that takes the reader to the page where the missing thing is set
 * up. Staff who cannot open that page see `fallback` instead (nothing when
 * it is left out). `confirm`, when given, runs first and returning false
 * stays put -- for leaving a form with unsaved edits.
 *
 * `back` is the booking being left, `{ reservationId, tab }` for a saved one
 * or `{ prefill }` for a new one, so the setup page can offer the way back.
 * A function is asked at the click, so it carries the form as it is then.
 */
export function SetUpLink({ page, children, fallback = null, confirm, back, className = "btn btn-secondary text-xs", style }) {
  const { openPage, leaveFor, canOpen } = usePageNav();
  if (!canOpen(page)) return fallback;
  async function go() {
    if (confirm && !(await confirm())) return;
    if (back) leaveFor(page, typeof back === "function" ? back() : back);
    else openPage(page);
  }
  return (
    <button type="button" className={className} style={style} onClick={go}>
      {children}
    </button>
  );
}
