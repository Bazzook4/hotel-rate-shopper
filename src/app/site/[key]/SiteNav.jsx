"use client";

import { usePathname } from "next/navigation";

/** The four page links, with the open page marked. */
export default function SiteNav({ base, links }) {
  const path = (usePathname() || "").replace(/\/$/, "");
  const here = (l) => (l.match === "home" ? path === base.replace(/\/$/, "") : path === l.href);
  return (
    <nav className="site-nav" aria-label="Pages">
      {links.map((l) => (
        <a key={l.href} href={l.href} aria-current={here(l) ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
