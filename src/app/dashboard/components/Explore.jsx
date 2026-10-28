"use client";

import { useEffect, useRef, useState } from "react";
import { FEATURE_GUIDE } from "@/lib/featureGuide";
import Icon from "../../components/Icon";
import WhatsNew from "./WhatsNew";

/**
 * Explore: every page the reader can open, what it is for and when to use
 * it, grouped by area as the menu is, each with a button that opens it.
 * What's new is the second tab, so the changes stay one click away.
 *
 * Only pages the reader holds are listed, for the same reason What's new
 * leaves them out: a housekeeper has no use for Dynamic Pricing.
 */
export default function Explore({ areas, onOpenPage, canOpen, pageLabel, hasNews, onNewsSeen }) {
  // Someone who came because of the New mark is shown the news first.
  const [tab, setTab] = useState(hasNews ? "news" : "features");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (tab === "news") onNewsSeen();
  }, [tab, onNewsSeen]);

  // Every word typed must appear somewhere on the card, in any order, as in
  // the Ctrl+K palette, so "check in" finds "Check guests in".
  const words = query.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  const groups = areas
    .map((area) => ({
      ...area,
      pages: area.pages.filter((p) => {
        const guide = FEATURE_GUIDE[p.id];
        if (!guide) return false;
        const hay = [area.label, p.label, guide.what, ...guide.use].join(" ").toLowerCase().replace(/-/g, " ");
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((a) => a.pages.length);
  const found = groups.flatMap((a) => a.pages);

  // Ready to type on a laptop; a phone would throw its keyboard up.
  const searchRef = useRef(null);
  useEffect(() => {
    if (tab === "features" && window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="h1">Explore</h2>
        {tab === "features" && (
          <input
            ref={searchRef}
            type="search"
            className="input min-w-0 flex-1 md:max-w-sm"
            placeholder="Search, e.g. invoice, stop sell, police"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && words.length && found.length === 1) onOpenPage(found[0].id);
            }}
            aria-label="Search the features"
          />
        )}
        <div className="seg ml-auto" role="group" aria-label="What to show">
          <button type="button" className={tab === "features" ? "seg-on" : ""} aria-pressed={tab === "features"} onClick={() => setTab("features")}>
            All features
          </button>
          <button type="button" className={tab === "news" ? "seg-on" : ""} aria-pressed={tab === "news"} onClick={() => setTab("news")}>
            What&apos;s new
            {hasNews && tab !== "news" && (
              <span
                className="ml-1.5 rounded px-1 py-[1px] text-[8.5px] font-semibold uppercase tracking-wide"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                New
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === "news" ? (
        <WhatsNew onOpenPage={onOpenPage} canOpen={canOpen} pageLabel={pageLabel} />
      ) : (
        <>
          {!groups.length && (
            <div className="card card-pad flex flex-wrap items-center gap-3">
              <p className="sub flex-1">
                Nothing matches &quot;{query.trim()}&quot;. Looking for a booking or a guest? Press Ctrl+K.
              </p>
              <button type="button" className="btn btn-ghost text-sm" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          )}

          {groups.map((area) => (
            <section key={area.id} className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                {area.label}
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {area.pages.map((p) => {
                  const guide = FEATURE_GUIDE[p.id];
                  return (
                    <div key={p.id} className="card flex flex-col gap-1.5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span style={{ color: "var(--accent)" }}>
                            <Icon name={p.icon} />
                          </span>
                          <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                            {p.label}
                          </h4>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost min-h-[32px] px-2.5 py-1 text-sm"
                          onClick={() => onOpenPage(p.id)}
                          aria-label={`Open ${p.label}`}
                        >
                          Open
                        </button>
                      </div>
                      <p className="text-sm" style={{ color: "var(--text)" }}>
                        {guide.what}
                      </p>
                      <ul className="space-y-0.5">
                        {guide.use.map((u) => (
                          <li key={u} className="flex gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                            <span aria-hidden className="pt-0.5" style={{ color: "var(--accent)" }}>
                              <Icon name="right" size={12} strokeWidth={2.2} />
                            </span>
                            <span className="flex-1">{u}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
