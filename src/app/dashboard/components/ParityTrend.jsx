"use client";

import { useMemo } from "react";

/**
 * Your rate against the range every other channel is selling at.
 *
 * The grid answers "what is each channel charging tonight"; this answers the
 * question the grid makes hard -- whether the gap is widening, and on which
 * nights. A line per channel would be the obvious chart and the wrong one:
 * eight channels means eight lines that cross constantly, and the thing being
 * looked for is one line's position against the rest, not eight trajectories.
 *
 * So the competition is drawn as a band from cheapest to dearest each night,
 * and the property's own rate as a single line over it. Inside the band is
 * competitive, below it is leaving money behind, above its top edge is being
 * undercut by everyone.
 *
 * Drawn as inline SVG rather than with a chart library: it is one band and
 * one line, and the axes are the only fiddly part.
 */

/** Plot area, in the SVG's own coordinates. */
const WIDTH = 760;
const HEIGHT = 240;
const PADDING = { top: 16, right: 16, bottom: 28, left: 52 };

function money(value, currency) {
  if (value == null) return "-";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "₹";
  return `${symbol}${Math.round(value).toLocaleString("en-IN")}`;
}

/** Round a bound out to a readable number, so the axis reads 1,500 not 1,487. */
function niceBound(value, direction) {
  if (!Number.isFinite(value) || value === 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  const step = magnitude / 2;
  return direction === "up"
    ? Math.ceil(value / step) * step
    : Math.floor(value / step) * step;
}

export default function ParityTrend({ data, ownChannelKey }) {
  const model = useMemo(() => {
    if (!data?.dates?.length || !data?.channels?.length) return null;

    // The property's own listing is a channel like any other in the data, so
    // it has to be separated out before the rest can be called "competition".
    const own = data.channels.find((c) => c.key === ownChannelKey) || null;
    const others = data.channels.filter((c) => c.key !== own?.key);

    const points = data.dates.map((date) => {
      const rates = [];
      for (const channel of others) {
        const rate = channel.cells[date]?.rate;
        if (rate != null) rates.push(rate);
      }
      return {
        date,
        ownRate: own?.cells[date]?.rate ?? null,
        low: rates.length ? Math.min(...rates) : null,
        high: rates.length ? Math.max(...rates) : null,
      };
    });

    const values = points.flatMap((p) => [p.ownRate, p.low, p.high].filter((v) => v != null));
    if (values.length === 0) return null;

    const min = niceBound(Math.min(...values) * 0.95, "down");
    const max = niceBound(Math.max(...values) * 1.05, "up");
    // A flat week would otherwise divide by zero and collapse the chart.
    const span = max - min || 1;

    const innerWidth = WIDTH - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const x = (index) =>
      PADDING.left +
      (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y = (value) => PADDING.top + innerHeight - ((value - min) / span) * innerHeight;

    return { points, min, max, x, y, own, hasOwn: Boolean(own) };
  }, [data, ownChannelKey]);

  if (!model) return null;

  const { points, min, max, x, y, own, hasOwn } = model;
  const currency = data.channels[0]?.cells?.[data.dates[0]]?.currency;

  // The band is drawn as one shape: along the top edge, then back along the
  // bottom. Nights nobody priced are skipped rather than drawn as zero, which
  // would pull the band to the floor and misrepresent the week.
  const banded = points.filter((p) => p.low != null && p.high != null);
  const bandPath =
    banded.length > 1
      ? [
          ...banded.map((p, i) => `${i === 0 ? "M" : "L"} ${x(points.indexOf(p))} ${y(p.high)}`),
          ...[...banded]
            .reverse()
            .map((p) => `L ${x(points.indexOf(p))} ${y(p.low)}`),
          "Z",
        ].join(" ")
      : null;

  const ownPath = points
    .map((p, i) => (p.ownRate == null ? null : `${x(i)} ${y(p.ownRate)}`))
    .filter(Boolean)
    .map((pair, i) => `${i === 0 ? "M" : "L"} ${pair}`)
    .join(" ");

  const ticks = [min, min + (max - min) / 2, max];

  return (
    <div className="card card-pad">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600 }}>Rate trend</h3>
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              style={{
                width: 14,
                height: 3,
                background: "var(--accent)",
                borderRadius: 2,
                display: "inline-block",
              }}
            />
            {hasOwn ? "Your rate" : "Your rate (not found)"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              style={{
                width: 14,
                height: 10,
                background: "var(--warn-soft)",
                border: "1px solid var(--warn)",
                borderRadius: 2,
                display: "inline-block",
              }}
            />
            Other channels
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: "100%", height: "auto", marginTop: 8, overflow: "visible" }}
        role="img"
        aria-label="Your rate compared with the range other channels are charging each night"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PADDING.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              style={{ fontSize: 10, fill: "var(--text-faint)" }}
            >
              {money(tick, currency)}
            </text>
          </g>
        ))}

        {bandPath && (
          <path d={bandPath} fill="var(--warn-soft)" stroke="var(--warn)" strokeWidth="1" opacity="0.85" />
        )}

        {ownPath && <path d={ownPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" />}

        {points.map((p, i) =>
          p.ownRate == null ? null : (
            <circle key={p.date} cx={x(i)} cy={y(p.ownRate)} r="3.5" fill="var(--accent)">
              <title>{`${p.date}: you ${money(p.ownRate, currency)}${
                p.low != null ? `, others ${money(p.low, currency)}–${money(p.high, currency)}` : ""
              }`}</title>
            </circle>
          )
        )}

        {points.map((p, i) => (
          <text
            key={p.date}
            x={x(i)}
            y={HEIGHT - 8}
            textAnchor="middle"
            style={{ fontSize: 10, fill: "var(--text-faint)" }}
          >
            {new Date(`${p.date}T00:00:00Z`).getUTCDate()}
          </text>
        ))}
      </svg>

      <p className="text-xs" style={{ color: "var(--text-faint)", marginTop: 4 }}>
        {hasOwn
          ? "Your line inside the band means you are priced with the market. Below it you are the cheapest; above its top edge every channel is undercutting you."
          : "Your own listing did not appear in these results, so only the range other channels are charging is shown."}
      </p>
    </div>
  );
}
