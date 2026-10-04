"use client";

import { useCallback, useState } from "react";

/**
 * useState that survives leaving the page: the dates, window and filters a
 * page was on are there again when the desk comes back to it.
 *
 * The front desk is interrupted all day, and what an interruption really
 * costs is finding your place again. Pages unmount when another is opened,
 * so without this every return started over on today and the default view.
 *
 * Kept in sessionStorage -- this browser tab only -- and only for the day it
 * was set: a calendar left on last Tuesday should open on today tomorrow.
 * The same key is shared across hotels, so switching property keeps the
 * page where it was.
 */

const today = () => new Date().toISOString().slice(0, 10);

function read(key) {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(`hms.page.${key}`);
    if (!raw) return undefined;
    const { day, value } = JSON.parse(raw);
    return day === today() ? value : undefined;
  } catch {
    return undefined;
  }
}

export function usePageState(key, initial) {
  const [value, setValue] = useState(() => {
    const saved = read(key);
    if (saved !== undefined) return saved;
    return typeof initial === "function" ? initial() : initial;
  });

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          sessionStorage.setItem(`hms.page.${key}`, JSON.stringify({ day: today(), value: resolved }));
        } catch {}
        return resolved;
      });
    },
    [key]
  );

  return [value, set];
}
