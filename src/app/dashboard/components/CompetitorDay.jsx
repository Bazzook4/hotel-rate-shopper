"use client";

import { parseDateISO } from "@/lib/date";

function money(value) {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

/**
 * One day, competitor by competitor.
 *
 * Shows only what a rate lookup actually returns. Occupancy and rooms-sold
 * belong to a PMS this product is not connected to, so they are absent rather
 * than guessed at -- a made-up number here would be acted on.
 */
export default function CompetitorDay({ date, data, onClose, onPrev, onNext }) {
  const own = data.ownByDate?.[date] ?? null;
  const median = data.medianByDate?.[date] ?? null;
  const diff = data.diffByDate?.[date] ?? null;

  // Competitors that quoted a rate, cheapest first, then the ones that did
  // not -- a sold-out or unchecked hotel still belongs on the list, since its
  // absence is itself worth seeing.
  const rows = (data.competitors || [])
    .map((c) => ({ competitor: c, cell: c.cells?.[date] || null }))
    .sort((a, b) => {
      const ra = a.cell?.rate ?? null;
      const rb = b.cell?.rate ?? null;
      if (ra == null && rb == null) return a.competitor.name.localeCompare(b.competitor.name);
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (ra !== rb) return ra - rb;
      return a.competitor.name.localeCompare(b.competitor.name);
    });

  const label = parseDateISO(date)?.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Where our own rate would sit if it were in the list.
  const cheaperThanUs =
    own == null ? null : rows.filter((r) => r.cell?.rate != null && r.cell.rate < own).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={onPrev} aria-label="Previous day">
            ‹
          </button>
          <h3 className="h2" style={{ minWidth: 220, textAlign: "center" }}>
            {label}
          </h3>
          <button type="button" className="btn" onClick={onNext} aria-label="Next day">
            ›
          </button>
        </div>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      {/* Headline numbers */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div
          className="card card-pad"
          style={
            diff == null
              ? {}
              : diff <= 0
              ? { background: "var(--accent-soft)", borderColor: "var(--accent)" }
              : { background: "var(--danger-soft)", borderColor: "var(--danger)" }
          }
        >
          <div className="label">My rate</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>
            {own != null ? `₹${money(own)}` : "Not priced"}
          </div>
          {diff != null && (
            <div
              className="text-sm"
              style={{ fontWeight: 600, color: diff <= 0 ? "var(--accent-text)" : "var(--danger)" }}
            >
              {diff > 0 ? "+" : ""}
              {diff.toFixed(1)}% vs median
            </div>
          )}
          {own == null && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Refresh Rate Parity to price this night
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="label">Median competitor rate</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>
            {median != null ? `₹${money(median)}` : "—"}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Across {rows.filter((r) => r.cell?.rate != null).length} of {rows.length} competitors
          </div>
        </div>

        {cheaperThanUs != null && (
          <div className="card card-pad">
            <div className="label">Cheaper than you</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{cheaperThanUs}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {cheaperThanUs === 0
                ? "You are the cheapest tracked hotel"
                : `of ${rows.length} tracked competitors`}
            </div>
          </div>
        )}
      </div>

      {/* Competitor by competitor */}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="grid-table">
          <thead>
            <tr>
              <th>Property name</th>
              <th className="text-right">Lowest rate</th>
              <th>Room</th>
              <th>Channel</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ competitor, cell }) => {
              const missing = !cell || cell.rate == null;
              return (
                <tr key={competitor.id} style={missing ? { color: "var(--text-faint)" } : undefined}>
                  <td style={{ fontWeight: 500 }}>{competitor.name}</td>
                  <td className="text-right">
                    {cell?.rate != null ? (
                      cell.link ? (
                        <a
                          href={cell.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "inherit", fontWeight: 600 }}
                        >
                          {money(cell.rate)}
                        </a>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{money(cell.rate)}</span>
                      )
                    ) : cell?.soldOut ? (
                      "SOLD"
                    ) : (
                      "Not checked"
                    )}
                  </td>
                  <td>
                    {cell?.roomName || <span style={{ color: "var(--text-faint)" }}>—</span>}
                    {cell?.freeCancellation && (
                      <span className="chip chip-ok" style={{ marginLeft: 6 }}>
                        Free cancellation
                      </span>
                    )}
                  </td>
                  <td>{cell?.channel || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                </tr>
              );
            })}
            {own != null && (
              <tr style={{ background: "var(--surface-2)" }}>
                <td style={{ fontWeight: 600 }}>{data.propertyName} (you)</td>
                <td className="text-right" style={{ fontWeight: 600 }}>
                  {money(own)}
                </td>
                <td colSpan={2} className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Your cheapest channel, from Rate Parity
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        Rate: lowest across channels · {data.guests} guests · {data.nights} night
        {data.nights === 1 ? "" : "s"}. Google names the room only on some listings, so it can be
        blank where a rate is shown.
      </p>
    </div>
  );
}
