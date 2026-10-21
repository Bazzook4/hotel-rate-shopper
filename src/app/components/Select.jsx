"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import usePopupClose, { isTouch, placeBelowOrAbove } from "./usePopupClose";

/** Lists longer than this get a search box at the top. */
const SEARCH_FROM = 10;
/** Lists longer than this are not all laid out to size the button. */
const SIZE_FROM = 30;

/**
 * The app's form select, in place of the browser's own.
 *
 * A native select's list is drawn by the browser -- on a Mac a grey system
 * menu, on Windows a plain box -- and never matched the app. This one is
 * drawn by the app in the same panel as every other menu (.dd-list).
 *
 * It takes what a native select takes -- value, onChange, className, style,
 * disabled, id, <option> and <optgroup> children -- and onChange gets an
 * event-shaped { target: { value } } with the value as a string, as a
 * native one does. Swapping one in is a rename, and the handlers stay.
 *
 * The button keeps the className it is given, so `input`, `cm-input` and
 * so on look as they did, with the app's chevron drawn inside. With `width: auto` it is as wide as its longest
 * option, as a native select is, so it does not jump when the choice
 * changes.
 *
 * A list longer than ten has a search box; on a phone it waits for a tap,
 * so the keyboard does not cover the list on opening. Keyboard: Enter,
 * Space or the arrows open; arrows, Home, End move; typing on a closed
 * short list changes the choice as a native one does, and on an open one
 * jumps to a match (or filters, with a search box); Enter picks; Escape or
 * Tab closes.
 */
export default function Select({
  ref,
  value,
  onChange,
  children,
  className = "input",
  style,
  disabled,
  id,
  name,
  title,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}) {
  const options = [];
  collect(children, null, options);
  const current = options.find((o) => o.value === String(value ?? "")) || options[0];

  const [at, setAt] = useState(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const btn = useRef(null);
  const list = useRef(null);
  const search = useRef(null);
  const typed = useRef({ text: "", at: 0 });
  const ownId = useId();
  const listId = `${ownId}-list`;
  const btnId = id || `${ownId}-btn`;

  useImperativeHandle(ref, () => btn.current);

  const searchable = options.length > SEARCH_FROM;
  const q = at ? query.trim().toLowerCase() : "";
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  useEffect(() => {
    if (autoFocus) btn.current?.focus();
  }, [autoFocus]);

  usePopupClose(Boolean(at), [btn, list], () => setAt(null));

  useEffect(() => {
    if (at && searchable && (at.query || !isTouch())) search.current?.focus();
  }, [at, searchable]);

  useEffect(() => {
    if (at) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at, active]);

  function open(startQuery = "") {
    if (disabled) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.max(r.width, 160);
    setQuery(startQuery);
    setActive(startQuery ? 0 : Math.max(0, options.indexOf(current)));
    setAt({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      query: startQuery,
      // Opens upward when there is no room below, as a native select does,
      // and never runs off a short screen.
      ...placeBelowOrAbove(r, 300),
    });
  }

  function close() {
    setAt(null);
    btn.current?.focus();
  }

  function pick(o) {
    if (!o || o.disabled) return;
    close();
    if (o.value !== current?.value) {
      const target = { value: o.value, name, id };
      onChange?.({ target, currentTarget: target });
    }
  }

  /** Typing a few letters moves to the next option that starts with them. */
  function typeAhead(ch) {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? ch : t.text + ch;
    t.at = now;
    const from = at ? active : options.indexOf(current);
    const n = shown.length;
    for (let k = 1; k <= n; k += 1) {
      const i = (from + (t.text.length > 1 ? k - 1 : k) + n) % n;
      if (!shown[i].disabled && shown[i].label.toLowerCase().startsWith(t.text)) return i;
    }
    return -1;
  }

  function move(step) {
    setActive((i) => {
      let j = i;
      for (let k = 0; k < shown.length; k += 1) {
        j = Math.min(shown.length - 1, Math.max(0, j + step));
        if (!shown[j]?.disabled) return j;
      }
      return i;
    });
  }

  function onKeyDown(e) {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!at) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        open();
      } else if (printable) {
        e.preventDefault();
        if (searchable) open(e.key);
        else {
          const i = typeAhead(e.key.toLowerCase());
          if (i >= 0) pick(shown[i]);
        }
      }
      return;
    }
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home" && !searchable) setActive(0);
    else if (e.key === "End" && !searchable) setActive(shown.length - 1);
    else if (e.key === "Enter" || (e.key === " " && !searchable)) pick(shown[active]);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") {
      // The list sits at the end of the page; back on the button first, so
      // Tab goes on to the next field rather than off the page.
      btn.current?.focus();
      setAt(null);
      return;
    } else if (printable && !searchable) {
      const i = typeAhead(e.key.toLowerCase());
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  }

  let lastGroup = null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={btnId}
        role="combobox"
        className={`sel ${className}`}
        style={style}
        title={title}
        disabled={disabled}
        onClick={() => (at ? close() : open())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={Boolean(at)}
        aria-controls={at ? listId : undefined}
        aria-activedescendant={at && !searchable && shown[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
      >
        {/* Every label sits in one grid cell, only the chosen one visible,
            so the button is as wide as the longest. */}
        <span className="sel-sizer">
          <span className="sel-value">{current?.label ?? ""}</span>
          {options.length <= SIZE_FROM && options.map((o) => (
            <span key={o.key} className="sel-ghost" aria-hidden>
              {o.label}
            </span>
          ))}
        </span>
        <svg className="sel-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {at &&
        createPortal(
          <div
            ref={list}
            className="dd-list sel-list"
            style={{ position: "fixed", left: at.left, top: at.top, bottom: at.bottom, minWidth: at.width, maxHeight: Math.min(at.maxHeight, 320) }}
            onKeyDown={onKeyDown}
          >
            {searchable && (
              <div className="sel-search">
                <Icon name="search" size={14} />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search"
                  role="combobox"
                  aria-label="Search the list"
                  aria-expanded
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                />
              </div>
            )}
            <ul id={listId} role="listbox" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : labelledBy || btnId} className="sel-options">
              {shown.map((o, i) => {
                const head = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <Fragment key={o.key}>
                    {head && (
                      <li className="sel-group" role="presentation">
                        {head}
                      </li>
                    )}
                    <li
                      id={`${listId}-${i}`}
                      data-i={i}
                      role="option"
                      aria-selected={o === current}
                      aria-disabled={o.disabled || undefined}
                      className={`dd-option${i === active ? " dd-active" : ""}`}
                      onMouseEnter={() => !o.disabled && setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      <span className="dd-check" aria-hidden>
                        {o === current && <Icon name="check" size={14} strokeWidth={2.2} />}
                      </span>
                      {o.label}
                    </li>
                  </Fragment>
                );
              })}
              {shown.length === 0 && <li className="sel-empty">Nothing matches</li>}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}

/** The <option>s under `children`, through fragments, arrays and <optgroup>s. */
function collect(children, group, out) {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === "option") {
      const label = text(c.props.children);
      const value = String(c.props.value ?? label);
      out.push({ key: `${group ?? ""}|${value}|${out.length}`, value, label, disabled: Boolean(c.props.disabled), group });
    } else if (c.type === "optgroup") {
      collect(c.props.children, c.props.label, out);
    } else if (c.type === Fragment) {
      collect(c.props.children, group, out);
    }
  });
}

function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text(node.props.children);
  return "";
}
