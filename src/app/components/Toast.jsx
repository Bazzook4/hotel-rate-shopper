"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Icon from "./Icon";

/**
 * Short confirmations at the foot of the screen, with an Undo where the
 * action can be taken back.
 *
 * An undo replaces an "Are you sure?" only where reversing is really the
 * same as never having done it. Anything that cannot be put back -- a
 * deleted room, a voided payment -- keeps its confirmation.
 */

const ToastContext = createContext(null);

const DEFAULT_MS = 4000;
// Long enough to read the message and reach for Undo.
const UNDO_MS = 8000;
// A next step (Print invoice) is wanted while the guest is still at the desk.
const ACTION_MS = 15000;

let nextId = 1;

function ToastItem({ toast, onDismiss }) {
  const [busy, setBusy] = useState(false);

  // A toast with a button waits while the pointer is on it, so it does not
  // vanish from under someone reaching for the button.
  const [paused, setPaused] = useState(false);
  // A new message (an undo that failed) starts the clock again.
  useEffect(() => {
    if (paused || busy) return undefined;
    const t = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [paused, busy, toast.id, toast.duration, toast.message, onDismiss]);

  async function undo() {
    setBusy(true);
    try {
      await toast.undo();
      onDismiss(toast.id);
    } catch (err) {
      // The undo itself failed: say so in place of the original message.
      toast.replace?.(err?.message || "Could not undo that.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction() {
    setBusy(true);
    try {
      await toast.action.run();
      onDismiss(toast.id);
    } catch (err) {
      toast.replace?.(err?.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`toast ${toast.tone === "error" ? "toast-error" : ""}`}
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={runAction} disabled={busy}>
          {busy ? toast.action.busyLabel || "Working..." : toast.action.label}
        </button>
      )}
      {toast.undo && (
        <button type="button" onClick={undo} disabled={busy}>
          {busy ? "Undoing..." : "Undo"}
        </button>
      )}
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  /**
   * Show a message. `undo` is an async function that reverses the action;
   * if it throws, its message replaces the toast's. `action` is a next step,
   * `{ label, busyLabel, run }`, failing the same way.
   */
  const show = useCallback((message, { undo = null, action = null, tone = "info", duration } = {}) => {
    const id = nextId++;
    const replace = (text) =>
      setToasts((all) =>
        all.map((t) => (t.id === id ? { ...t, message: text, undo: null, action: null, tone: "error", duration: DEFAULT_MS } : t))
      );
    const toast = {
      id,
      message,
      undo,
      action,
      tone,
      replace,
      duration: duration ?? (action ? ACTION_MS : undo ? UNDO_MS : DEFAULT_MS),
    };
    // Three at most: past that the oldest has stopped being news.
    setToasts((all) => [...all.slice(-2), toast]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * `toast(message, { undo, action, tone })`. Outside a provider -- the admin pages --
 * it does nothing, so a component can call it without knowing where it sits.
 */
export function useToast() {
  return useContext(ToastContext) || noop;
}

function noop() {
  return null;
}
