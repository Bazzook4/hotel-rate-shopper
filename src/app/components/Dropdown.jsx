"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A compact dropdown for toolbars: "Room type: All ▾".
 *
 * A native select draws itself the way each browser likes -- on a Mac a
 * grey double-chevron box with the system's own menu -- so in the filter
 * row it never matched the date stepper beside it. This is drawn by the app:
 * the same height and outline as the .seg buttons, the label inside the
 * button rather than on a line above it, and a list in the app's colours.
 *
 * The list is rendered into the body and placed against the viewport, as
 * Rate Plan Setup's row menu is, so a scrolling grid cannot clip it.
 *
 * Keyboard: Enter, Space or ↓ opens; ↑ ↓ Home End move; Enter picks;
 * Escape or Tab closes.
 *
 * options: [{ value, label }]. `label` names what is chosen; leave it out
 * when the option labels say it themselves ("2 guests").
 */
export default function Dropdown({ label, value, options, onChange, ariaLabel, minWidth }) {
  const [at, setAt] = useState(null);
  const [active, setActive] = useState(0);
  const btn = useRef(null);
  const list = useRef(null);
  const id = useId();

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[index];

  useEffect(() => {
    if (!at) return undefined;
    const close = (e) => {
      if (list.current?.contains(e.target) || btn.current?.contains(e.target)) return;
      setAt(null);
    };
    // Scrolling inside the list is fine; the page scrolling would leave the
    // list floating away from its button.
    const onScroll = (e) => {
      if (!list.current?.contains(e.target)) setAt(null);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  useEffect(() => {
    if (at) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at, active]);

  function open() {
    const r = btn.current.getBoundingClientRect();
    const width = Math.max(r.width, 180);
    const below = window.innerHeight - r.bottom;
    setActive(index);
    setAt({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      // Opens upward when there is no room below, as a native select does.
      ...(below < 260 && r.top > below
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
  }

  function pick(i) {
    const o = options[i];
    setAt(null);
    btn.current?.focus();
    if (o && o.value !== value) onChange(o.value);
  }

  function onKeyDown(e) {
    if (!at) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        open();
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape") setAt(null);
    else if (e.key === "Tab") {
      setAt(null);
      return;
    } else return;
    e.preventDefault();
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="dd"
        style={minWidth ? { minWidth } : undefined}
        onClick={() => (at ? setAt(null) : open())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={Boolean(at)}
        aria-controls={at ? id : undefined}
        aria-label={ariaLabel || (label ? `${label}: ${current?.label ?? ""}` : undefined)}
        aria-activedescendant={at ? `${id}-${active}` : undefined}
      >
        {label && <span className="dd-label">{label}</span>}
        <span className="dd-value">{current?.label ?? "—"}</span>
        <svg className="dd-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {at &&
        createPortal(
          <ul
            ref={list}
            id={id}
            role="listbox"
            aria-label={label || ariaLabel}
            className="dd-list"
            style={{ position: "fixed", left: at.left, top: at.top, bottom: at.bottom, minWidth: at.width }}
          >
            {options.map((o, i) => (
              <li
                key={String(o.value)}
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={`dd-option${i === active ? " dd-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                <span className="dd-check" aria-hidden>
                  {o.value === value ? "✓" : ""}
                </span>
                {o.label}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
