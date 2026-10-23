"use client";

import { RELEASE_NOTES } from "@/lib/releaseNotes";
import Icon from "../../components/Icon";

/**
 * What changed in the app, in plain words, newest first. Shown as the
 * second tab of Explore, which gives it its heading.
 *
 * A point about a page the reader cannot open is left out, since telling a
 * housekeeper about Dynamic Pricing is noise; a release with nothing left
 * for them is left out whole. Every point that names a page opens it.
 */

const longDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function WhatsNew({ onOpenPage, canOpen, pageLabel }) {
  const releases = RELEASE_NOTES.map((r) => ({
    ...r,
    points: r.points.filter((p) => !p.page || canOpen(p.page)),
  })).filter((r) => r.points.length);

  return (
    <div className="space-y-4">
      {!releases.length && <div className="card card-pad sub">Nothing new yet.</div>}

      {releases.map((r) => (
        <div key={r.date} className="card card-pad space-y-3">
          <div>
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              {longDate(r.date)}
            </p>
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              {r.title}
            </h3>
          </div>
          <ul className="space-y-2">
            {r.points.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <span aria-hidden style={{ color: "var(--accent)" }}>
                  <Icon name="check" size={14} strokeWidth={2.2} />
                </span>
                <span className="flex-1">
                  {p.text}
                  {p.page && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => onOpenPage(p.page)}
                        className="whitespace-nowrap font-semibold underline underline-offset-2"
                        style={{ color: "var(--accent-text)" }}
                      >
                        Open {pageLabel(p.page)}
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
