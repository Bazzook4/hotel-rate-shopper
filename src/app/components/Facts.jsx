"use client";

/**
 * The one way the app shows what a record is right now: a one-row table in
 * the look of every list (Status: Confirmed, Room: S101, Balance: owes
 * Rs 2,625), above the record's buttons.
 *
 * Facts are ruled cells of plain text, never pills, so they cannot be
 * mistaken for a button or an alert. A fact that opens something takes
 * onClick and reads as a link. Chips stay for small tags inside lists and tables.
 *
 * tone: "warn" for money owed or something waiting, "ok" for done.
 */
export function Facts({ children, className = "" }) {
  return <div className={`facts ${className}`}>{children}</div>;
}

export function Fact({ label, tone, onClick, title, children }) {
  const cls = `fact-value${tone ? ` fact-${tone}` : ""}`;
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      {onClick ? (
        <button type="button" className={`${cls} fact-link`} onClick={onClick} title={title}>
          {children}
        </button>
      ) : (
        <span className={cls} title={title}>
          {children}
        </span>
      )}
    </div>
  );
}
