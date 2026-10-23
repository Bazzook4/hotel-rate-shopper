"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { useEscape } from "./useEscape";

/**
 * The row's action menu. Rendered into the body and positioned against the
 * viewport: inside the grid it would be clipped by the sideways scroll, and
 * the sticky name cells below it would paint over it.
 *
 * With a label it is a bordered "More" button for a toolbar, as on a
 * booking; without one, the small dots button at the end of a grid row.
 * `buttonClass` restyles the button, as for the top bar's Account menu.
 */
export default function RowMenu({ title, items, label, buttonClass }) {
  const [at, setAt] = useState(null);
  const [sub, setSub] = useState(null);
  useEscape(() => {
    setAt(null);
    setSub(null);
  }, Boolean(at));
  const btn = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (!at) return undefined;
    const close = (e) => {
      if (box.current?.contains(e.target) || btn.current?.contains(e.target)) return;
      setAt(null);
      setSub(null);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);

  function toggle() {
    if (at) {
      setAt(null);
      setSub(null);
      return;
    }
    const r = btn.current.getBoundingClientRect();
    const width = 260;
    setAt({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      width,
    });
  }

  const pick = (fn) => {
    setAt(null);
    setSub(null);
    fn?.();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        className={buttonClass || (label ? "btn btn-secondary text-sm" : "btn btn-ghost px-2 py-0.5 text-base leading-none")}
        style={label ? undefined : { color: "var(--accent)" }}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        aria-label={label ? undefined : title}
      >
        {label ? (
          <>
            {label}
            <Icon name="down" size={14} />
          </>
        ) : (
          <Icon name="more" size={18} />
        )}
      </button>
      {at &&
        createPortal(
        <div
          ref={box}
          role="menu"
          className="pop"
          style={{ position: "fixed", top: at.top, left: at.left, width: at.width, zIndex: 60 }}
        >
          <div className="pop-head flex items-center justify-between">
            <span className="pop-title">{title}</span>
            <button type="button" className="cal-nav" style={{ width: "1.5rem", height: "1.5rem" }} onClick={() => pick()} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
          {items.map((it) => (
            <div key={it.label}>
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => (it.submenu ? setSub(sub === it.label ? null : it.label) : pick(it.onClick))}
                className={`pop-item${it.danger ? " pop-danger" : ""}`}
              >
                {it.label}
                {it.submenu && <span className="muted"><Icon name={sub === it.label ? "down" : "right"} size={14} /></span>}
              </button>
              {it.submenu && sub === it.label &&
                it.submenu.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    role="menuitem"
                    disabled={s.disabled}
                    onClick={() => pick(s.onClick)}
                    className="pop-item pop-sub-item"
                  >
                    {s.label}
                  </button>
                ))}
            </div>
          ))}
        </div>,
          document.body
        )}
    </>
  );
}
