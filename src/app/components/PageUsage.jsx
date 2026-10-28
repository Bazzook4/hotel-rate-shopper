"use client";

import { useEffect, useMemo, useState } from "react";
import { Facts, Fact } from "./Facts";
import Select from "./Select";
import { useSort, SortTh } from "../dashboard/components/useSort";

/**
 * Super admin only: how the app is used once a page is open, to choose what
 * to work on next. A page opened often but left at once, or one where people
 * ask for Help, needs work; a guide most people close early needs rewriting.
 * Anonymous, as the hotels are told (migrations 042 and 061).
 */

const PERIODS = [7, 30, 90];

const pct = (n, of) => (of ? Math.round((n / of) * 100) : null);

function duration(s) {
  if (s == null) return "-";
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.round(m / 6) / 10} h`;
}

const PAGE_SORT = {
  label: "label",
  opens: "opens",
  hotels: "hotels",
  time: (r) => r.median_seconds ?? -1,
  fast: (r) => r.fast_pct ?? -1,
  help: "help",
};

const TOUR_SORT = {
  title: "title",
  started: "started",
  done: (r) => r.done_pct ?? -1,
  quit: "quit",
};

export default function PageUsage({ hotels }) {
  const [days, setDays] = useState(30);
  const [property, setProperty] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    const q = new URLSearchParams({ days: String(days) });
    if (property) q.set("property", property);
    fetch(`/api/admin/usage/events?${q}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Could not load usage");
        return j;
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [days, property]);

  const pages = useMemo(
    () => (data?.pages || []).map((p) => ({ ...p, fast_pct: pct(p.left_fast, p.visits) })),
    [data]
  );
  const tours = useMemo(
    () => (data?.tours || []).map((t) => ({ ...t, done_pct: pct(t.done, t.started) })),
    [data]
  );
  const pageSorter = useSort(pages, PAGE_SORT, { key: "opens", dir: "desc" });
  const tourSorter = useSort(tours, TOUR_SORT, { key: "started", dir: "desc" });

  const t = data?.totals;
  const started = tours.reduce((n, x) => n + x.started, 0);
  const finished = tours.reduce((n, x) => n + x.done, 0);
  const unused = pages.filter((p) => !p.opens).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {PERIODS.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </Select>
        <Select value={property} onChange={(e) => setProperty(e.target.value)} aria-label="Hotel">
          <option value="">All hotels</option>
          {hotels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
      {!error && !data && <p className="sub">Loading...</p>}

      {data && (
        <>
          <Facts>
            <Fact label="Show me how opened">{t.guide}</Fact>
            <Fact label="Guides finished">
              {finished} of {started}
            </Fact>
            <Fact label="Help on WhatsApp" tone={t.help ? "warn" : undefined}>{t.help}</Fact>
            <Fact label="Feedback on WhatsApp">{t.feedback}</Fact>
            <Fact label="Ctrl+K opened">
              {t.palette}
              {t.palette > 0 && <span className="muted">, {t.paletteGo} found</span>}
            </Fact>
            <Fact label="Pages never opened">{unused}</Fact>
          </Facts>
          <p className="text-xs muted">
            Left at once means the page was left within 10 seconds without pressing anything.
            Typical time is the middle visit, with time in a hidden tab left out. Most pressed
            counts buttons and tabs by their words; inside a list it counts the column, so no
            guest or amount is ever kept. Super admin visits are left out.
          </p>

          <div className="card overflow-x-auto">
            <table className="grid-table min-w-full text-sm">
              <thead>
                <tr>
                  <SortTh sorter={pageSorter} col="label">Page</SortTh>
                  <SortTh sorter={pageSorter} col="opens">Opens</SortTh>
                  <SortTh sorter={pageSorter} col="hotels">Hotels</SortTh>
                  <SortTh sorter={pageSorter} col="time">Typical time</SortTh>
                  <SortTh sorter={pageSorter} col="fast">Left at once</SortTh>
                  <SortTh sorter={pageSorter} col="help">Asked for help</SortTh>
                  <th>Most pressed</th>
                </tr>
              </thead>
              <tbody>
                {pageSorter.rows.map((p) => (
                  <tr key={p.id}>
                    <td className="text-ink">{p.label}</td>
                    <td>{p.opens || <span className="muted">0</span>}</td>
                    <td>{p.hotels || "-"}</td>
                    <td>{duration(p.median_seconds)}</td>
                    <td>
                      {p.fast_pct == null ? (
                        "-"
                      ) : (
                        <span className={p.fast_pct >= 40 && p.visits >= 5 ? "chip chip-warn" : undefined}>
                          {p.fast_pct}%
                        </span>
                      )}
                    </td>
                    <td>{p.help || "-"}</td>
                    <td className="text-xs muted">
                      {p.top_clicks.length
                        ? p.top_clicks.map((c) => `${c.label} (${c.count})`).join(", ")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <table className="grid-table min-w-full text-sm">
              <thead>
                <tr>
                  <SortTh sorter={tourSorter} col="title">Show me how guide</SortTh>
                  <SortTh sorter={tourSorter} col="started">Started</SortTh>
                  <SortTh sorter={tourSorter} col="done">Finished</SortTh>
                  <SortTh sorter={tourSorter} col="quit">Closed early</SortTh>
                </tr>
              </thead>
              <tbody>
                {tourSorter.rows.map((x) => (
                  <tr key={x.id}>
                    <td className="text-ink">{x.title}</td>
                    <td>{x.started || <span className="muted">0</span>}</td>
                    <td>{x.done_pct == null ? "-" : `${x.done} (${x.done_pct}%)`}</td>
                    <td>
                      {x.quit || "-"}
                      {x.quit > 0 && x.quit_step != null && (
                        <span className="block text-xs muted">
                          usually at tip {x.quit_step} of {x.steps}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
