"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The pieces every setup page is built from, so they all read like the
 * Channel Manager.
 *
 * The CM works one way: a breadcrumb and title with the actions on the right,
 * one toolbar strip, then a ruled grid edited in place. Edits are held on the
 * page -- highlighted, not yet saved -- until one button sends them all, and
 * that button says how many there are. Setup pages had drifted into a mix of
 * card lists, pop-open forms and save-on-blur; this puts them back on the one
 * pattern a hotelier already knows from the rate grid.
 */

export function SetupHeader({ area = "Setup", title, count, sub, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] muted">Hotel Operations / {area}</p>
        <h2 className="h1">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-base font-normal muted">({count})</span>
          )}
        </h2>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** The one strip of filters and secondary actions above the grid. */
export function Toolbar({ children }) {
  return <div className="flex flex-wrap items-center gap-2 card p-3">{children}</div>;
}

/** The ruled grid, flush to its card like the CM's. */
export function Grid({ children }) {
  return (
    <div className="overflow-x-auto card" style={{ padding: 0 }}>
      <table className="cm-grid">{children}</table>
    </div>
  );
}

export function Messages({ error, notice }) {
  return (
    <>
      {error && (
        <div
          className="card px-4 py-2 text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}
      {notice && !error && <div className="card px-4 py-2 sub">{notice}</div>}
    </>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="space-y-3 text-center">
        <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
        <p className="sub">{label}</p>
      </div>
    </div>
  );
}

/** Discard + "Save N changes", the CM's Publish button for setup. */
export function SaveActions({ count, busy, onSave, onDiscard }) {
  return (
    <>
      {count > 0 && (
        <button type="button" className="btn btn-secondary" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      )}
      <button
        type="button"
        className="btn btn-primary"
        onClick={onSave}
        disabled={busy || count === 0}
      >
        {busy ? "Saving…" : count ? `Save ${count} change${count === 1 ? "" : "s"}` : "Save"}
      </button>
    </>
  );
}

/** Values compare as text: an input hands back "2" for a stored 2. */
function same(a, b) {
  const norm = (v) => (v === null || v === undefined ? "" : String(v));
  return norm(a) === norm(b);
}

/**
 * Edits held on the page until saved.
 *
 * `edits[id][field]` is the pending value. Setting a field back to what is
 * stored drops it, so undoing a change by hand also clears its highlight and
 * its place in the count. New rows are kept by the page as drafts; `extra`
 * adds them (and anything else pending, like a re-order) to the count.
 */
export function useEdits(extra = 0) {
  const [edits, setEdits] = useState({});

  const get = useCallback(
    (row, field) =>
      edits[row.id] && field in edits[row.id] ? edits[row.id][field] : row[field],
    [edits]
  );

  const set = useCallback((row, field, value) => {
    setEdits((prev) => {
      const mine = { ...(prev[row.id] || {}) };
      if (same(value, row[field])) delete mine[field];
      else mine[field] = value;
      const next = { ...prev };
      if (Object.keys(mine).length) next[row.id] = mine;
      else delete next[row.id];
      return next;
    });
  }, []);

  const isEdited = useCallback(
    (id, field) => Boolean(edits[id] && field in edits[id]),
    [edits]
  );

  const reset = useCallback(() => setEdits({}), []);

  /** Forget one row's edits, once they are saved. */
  const drop = useCallback((id) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const count = useMemo(
    () => Object.values(edits).reduce((n, e) => n + Object.keys(e).length, 0) + extra,
    [edits, extra]
  );

  // Leaving with unsaved edits loses them silently otherwise.
  useEffect(() => {
    if (count === 0) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  return { edits, get, set, isEdited, reset, drop, count };
}

/** Class for an input in the grid, accented while its edit is pending. */
export function cellClass(edited, invalid) {
  return `cm-input${edited ? " is-edited" : ""}${invalid ? " is-invalid" : ""}`;
}

/** A local id for a row not yet saved, never mistaken for a real one. */
let draftSeq = 0;
export function draftId() {
  draftSeq += 1;
  return `draft-${draftSeq}`;
}
export const isDraft = (id) => String(id).startsWith("draft-");

/** fetch that throws the server's own message on failure. */
export async function sendJSON(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

/**
 * A setup grid's working state: stored rows with pending edits, plus new
 * rows not yet saved, and one save that sends the lot.
 *
 * `rows` are the stored rows. `extra` counts anything else pending (a
 * re-order) toward the Save button.
 */
export function useGrid(rows, extra = 0) {
  const [drafts, setDrafts] = useState([]);
  const edits = useEdits(drafts.length + extra);

  const value = (row, field) => (isDraft(row.id) ? row[field] : edits.get(row, field));
  const edited = (row, field) => !isDraft(row.id) && edits.isEdited(row.id, field);

  function change(row, field, v) {
    if (isDraft(row.id)) {
      setDrafts((ds) => ds.map((d) => (d.id === row.id ? { ...d, [field]: v } : d)));
    } else {
      edits.set(row, field, v);
    }
  }

  /** The row as it will be once saved. */
  const merged = (row) => (isDraft(row.id) ? row : { ...row, ...(edits.edits[row.id] || {}) });

  const add = (blank) => {
    const id = draftId();
    setDrafts((ds) => [...ds, { ...blank, id }]);
    return id;
  };
  const removeDraft = (id) => setDrafts((ds) => ds.filter((d) => d.id !== id));

  function discard() {
    edits.reset();
    setDrafts([]);
  }

  /**
   * Send every pending edit and new row. Rows that save are cleared; rows
   * that fail keep their edits and are reported, so one bad value does not
   * throw away the rest of the work.
   */
  async function save({ update, create, label = (r) => r.name || "Row" }) {
    const errors = [];
    for (const [id, changes] of Object.entries(edits.edits)) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        edits.drop(id);
        continue;
      }
      try {
        await update(row, changes, { ...row, ...changes });
        edits.drop(id);
      } catch (err) {
        errors.push(`${label({ ...row, ...changes })}: ${err.message}`);
      }
    }
    for (const d of drafts) {
      try {
        await create(d);
        removeDraft(d.id);
      } catch (err) {
        errors.push(`${label(d) || "New row"}: ${err.message}`);
      }
    }
    return errors;
  }

  /** A text or number input bound to one field of one row. */
  function input(row, field, props = {}) {
    const { invalid, ...rest } = props;
    return (
      <input
        className={cellClass(edited(row, field), invalid)}
        value={value(row, field) ?? ""}
        onChange={(e) => change(row, field, e.target.value)}
        {...rest}
      />
    );
  }

  /** A select bound to one field; `options` are [{ id, label }]. */
  function select(row, field, options, props = {}) {
    return (
      <select
        className={cellClass(edited(row, field))}
        value={value(row, field) ?? ""}
        onChange={(e) => change(row, field, e.target.value)}
        {...props}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  /** A checkbox bound to one field, outlined while its edit is pending. */
  function check(row, field, props = {}) {
    return (
      <input
        type="checkbox"
        checked={Boolean(value(row, field))}
        onChange={(e) => change(row, field, e.target.checked)}
        style={
          edited(row, field)
            ? { outline: "2px solid var(--accent)", outlineOffset: 1 }
            : undefined
        }
        {...props}
      />
    );
  }

  return {
    drafts,
    count: edits.count,
    value,
    edited,
    change,
    merged,
    add,
    removeDraft,
    discard,
    save,
    input,
    select,
    check,
    pending: edits.edits,
  };
}
