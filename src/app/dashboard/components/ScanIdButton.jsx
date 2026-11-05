"use client";

import { useRef, useState } from "react";
import { readIdText } from "@/lib/idScan";

/**
 * The one Scan ID button. It opens the camera, reads the ID on this device
 * (nothing is sent anywhere to be read), and hands back what it found and
 * the photo. The page decides what to fill and whether to keep the photo.
 *
 * onRead(found, file): found has name, id_type, id_number, nationality and
 * date_of_birth, each blank when not read. Called even when nothing was read,
 * so the photo is not lost. Pass onNote to show the message elsewhere.
 */
export default function ScanIdButton({ onRead, onNote, disabled, label = "Scan ID", className = "btn btn-secondary text-xs", title }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const say = (m) => (onNote ? onNote(m) : setNote(m));

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    say("");
    let found = {};
    let message = "";
    try {
      const { readPhotoText } = await import("@/lib/idScanReader");
      found = readIdText(await readPhotoText(file));
      if (!found.id_number && !found.name) message = "Could not read this ID. Try again with the ID flat, in good light, or type it.";
      else if (!found.id_number) message = "Only the name could be read. Type the ID number.";
      else message = "Read from the ID. Please check the details.";
    } catch {
      message = "The reader did not start. Check the internet and try again, or type the ID.";
    }
    try {
      await onRead?.(found, file);
    } finally {
      say(message);
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} title={title || "Take a photo of the ID. It fills in the details."} onClick={() => inputRef.current?.click()}>
        {busy ? "Reading..." : label}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      {!onNote && note && (
        <span className="sub text-xs" role="status">
          {note}
        </span>
      )}
    </>
  );
}
