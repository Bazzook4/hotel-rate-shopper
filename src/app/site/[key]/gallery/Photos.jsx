"use client";

import { useState } from "react";
import { Gallery } from "@/app/book/kit";

/** The photo wall; a tap opens the same full-screen viewer the booking page uses. */
export default function Photos({ photos, name }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className="site-pics">
        {photos.map((u, i) => (
          <button key={u} type="button" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${photos.length}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null && <Gallery photos={photos} start={open} title={name} onClose={() => setOpen(null)} />}
    </>
  );
}
