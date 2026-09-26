"use client";

import { useEffect, useState } from "react";
import { inventoryWarning } from "@/lib/inventoryNotice";

/**
 * Taking one room out of order for some nights, or changing and ending that.
 *
 * Opened from a selection on the tape chart (new) or from a striped block
 * bar (existing). The dates follow a stay's convention -- the first night off
 * sale, and the day the room is back -- so the chart draws a block exactly as
 * it would a guest in those nights.
 */
export default function RoomBlockModal({ session, room, block, initial, onClose, onChanged }) {
  const [form, setForm] = useState({
    start_date: block?.start_date || initial?.start_date || "",
    end_date: block?.end_date || initial?.end_date || "",
    reason: block?.reason || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  async function send(method, body) {
    setBusy(true);
    setError(null);
    try {
      const url =
        method === "DELETE"
          ? `/api/pms/blocks?id=${block.id}${session?.propertyId ? `&propertyId=${session.propertyId}` : ""}`
          : "/api/pms/blocks";
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the block");
      onChanged?.(inventoryWarning(data));
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const body = {
      ...form,
      room_id: room.id,
      property_id: session?.propertyId || null,
    };
    send(block ? "PATCH" : "POST", block ? { ...body, id: block.id } : body);
  }

  function remove() {
    if (!window.confirm(`Put room ${room.room_number} back in service for these nights?`)) return;
    send("DELETE");
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "4rem 1rem",
      }}
    >
      <div
        className="card card-pad space-y-3"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 440, background: "var(--surface)" }}
      >
        <div style={{ fontWeight: 600 }}>
          {block ? "Out of order" : "Take out of order"} — Room {room.room_number}
        </div>
        <p className="sub" style={{ fontSize: "0.75rem" }}>
          The room cannot be booked or assigned for these nights, and the channel
          manager is sent one room fewer for its type.
        </p>

        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="label">First night out</label>
            <input
              className="input"
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Back in service on</label>
            <input
              className="input"
              type="date"
              min={form.start_date}
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Reason</label>
          <input
            className="input"
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="AC repair, repainting, plumbing…"
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          {block && (
            <button
              className="btn btn-ghost text-sm"
              style={{ color: "var(--danger)", marginRight: "auto" }}
              disabled={busy}
              onClick={remove}
            >
              Back in service
            </button>
          )}
          <button className="btn btn-ghost text-sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary text-sm" disabled={busy} onClick={save}>
            {busy ? "Saving…" : block ? "Save" : "Take out of order"}
          </button>
        </div>
      </div>
    </div>
  );
}
