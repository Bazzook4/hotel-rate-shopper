"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * The app's own confirm, prompt and pick-one dialogs, in place of the
 * browser's. The browser's look foreign, cannot offer a list to choose from,
 * and make the desk type what could be picked.
 *
 * Each call returns a promise, so a caller reads like the browser version:
 *
 *   if (!(await dialog.confirm({ title: "Delete room type?" }))) return;
 *   const reason = await dialog.prompt({ title: "Why is it being voided?" });
 *   const roomId = await dialog.choose({ title: "Which room?", options });
 *
 * Cancelling, Escape or a click outside answers false (confirm) or null.
 */

const DialogContext = createContext(null);

function DialogBox({ request, onDone }) {
  const { kind, title, message, label, placeholder, options = [], danger } = request;
  const [value, setValue] = useState(
    request.value ?? (kind === "choose" ? options[0]?.value ?? "" : "")
  );
  const fieldRef = useRef(null);
  const okRef = useRef(null);

  const cancel = useCallback(() => onDone(kind === "confirm" ? false : null), [kind, onDone]);
  const required = kind === "prompt" && request.required !== false;
  const blocked = (required && !String(value).trim()) || (kind === "choose" && !value);

  function ok() {
    if (blocked) return;
    onDone(kind === "confirm" ? true : kind === "prompt" ? String(value).trim() : value);
  }

  useEffect(() => {
    (fieldRef.current || okRef.current)?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  return (
    <div className="dialog-backdrop" onClick={cancel}>
      <form
        className="dialog card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h3>
        {message && (
          <p className="mt-1 text-sm whitespace-pre-line" style={{ color: "var(--text-muted)" }}>
            {message}
          </p>
        )}
        {kind === "prompt" && (
          <div className="mt-3">
            {label && <label className="label">{label}</label>}
            <input
              ref={fieldRef}
              className="input w-full"
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        )}
        {kind === "choose" && (
          <div className="mt-3">
            {label && <label className="label">{label}</label>}
            <select
              ref={fieldRef}
              className="input w-full"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={cancel}>
            {request.cancelLabel || "Cancel"}
          </button>
          <button
            ref={okRef}
            type="submit"
            className={`btn text-sm ${danger ? "btn-danger" : "btn-primary"}`}
            disabled={blocked}
          >
            {request.confirmLabel || "OK"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogProvider({ children }) {
  const [request, setRequest] = useState(null);

  const open = useCallback(
    (kind, opts) =>
      new Promise((resolve) => {
        setRequest({ ...opts, kind, resolve });
      }),
    []
  );

  const [api] = useState(() => ({
    confirm: (opts) => open("confirm", opts),
    prompt: (opts) => open("prompt", opts),
    choose: (opts) => open("choose", opts),
  }));

  const done = useCallback(
    (answer) => {
      setRequest((r) => {
        r?.resolve(answer);
        return null;
      });
    },
    []
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request && <DialogBox key={request.title} request={request} onDone={done} />}
    </DialogContext.Provider>
  );
}

/**
 * The browser's own dialogs, for a page outside the dashboard (the admin
 * page) that has no DialogProvider. Same answers, plainer look.
 */
const BROWSER_FALLBACK = {
  confirm: async ({ title, message }) => window.confirm([title, message].filter(Boolean).join("\n\n")),
  prompt: async ({ title, message }) => {
    const answer = window.prompt([title, message].filter(Boolean).join("\n\n"));
    return answer === null ? null : answer.trim();
  },
  choose: async ({ options = [] }) => options[0]?.value ?? null,
};

/** `{ confirm, prompt, choose }`, each returning a promise of the answer. */
export function useDialog() {
  return useContext(DialogContext) || BROWSER_FALLBACK;
}
