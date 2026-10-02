"use client";

import { useMemo, useState } from "react";

/**
 * Click a column header to sort the table by it; click again to reverse.
 *
 * `columns` maps a column key to how a row is read for sorting -- a field
 * name, or a function for anything derived. Numbers sort as numbers and
 * text in natural order ("Room 9" before "Room 10"); a row with nothing in
 * the column goes last either way, so blanks never crowd the top.
 *
 * `initial` is null to keep the order the rows arrived in until a header is
 * clicked: most lists already come in the order the desk works in.
 */

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

export function useSort(rows, columns, initial = null) {
  const [sort, setSort] = useState(initial);

  const sorted = useMemo(() => {
    if (!sort || !columns[sort.key]) return rows;
    const read = columns[sort.key];
    const get = typeof read === "function" ? read : (r) => r[read];
    const dir = sort.dir === "desc" ? -1 : 1;
    // Decorated with the original position, so equal rows keep their order.
    return rows
      .map((row, i) => ({ row, i, v: get(row) }))
      .sort((x, y) => {
        const xBlank = x.v == null || x.v === "";
        const yBlank = y.v == null || y.v === "";
        if (xBlank || yBlank) return xBlank === yBlank ? x.i - y.i : xBlank ? 1 : -1;
        return compare(x.v, y.v) * dir || x.i - y.i;
      })
      .map((d) => d.row);
  }, [rows, columns, sort]);

  /** A new column starts ascending; the same column flips. */
  function toggle(key) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return { rows: sorted, sort, toggle };
}

/**
 * The header cell for a sortable column. `sorter` is what useSort returned.
 * aria-sort tells a screen reader which way the column is ordered.
 */
export function SortTh({ sorter, col, children, className = "", style }) {
  const on = sorter.sort?.key === col;
  const dir = on ? sorter.sort.dir : null;
  return (
    <th
      className={className}
      style={style}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sort-th" data-on={on} onClick={() => sorter.toggle(col)}>
        {children}
        <span className="sort-arrow" aria-hidden>
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
        </span>
      </button>
    </th>
  );
}
