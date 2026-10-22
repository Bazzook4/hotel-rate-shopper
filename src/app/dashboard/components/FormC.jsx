"use client";

import { useState } from "react";
import { countryName } from "@/lib/countries";
import { FORM_C_PURPOSES, FORM_C_REQUIRED, FRRO_FORM_C_URL } from "@/lib/formC";
import { useToast } from "../../components/Toast";
import { useDialog } from "../../components/Dialog";
import { sendJSON } from "./SetupGrid";
import { BookingLink, Empty, Section, Stats, Status, TableFrame, longDate, timeOf, useReport, whole } from "./reportKit";

/**
 * Form C, as the second tab of the police report: every foreign guest who
 * checked in, when their form is due (24 hours after check-in), and whether
 * it has been filed.
 *
 * The form itself is filled in on the FRRO site; there is no way to send it
 * from here. So this page does not ask the desk to type the details twice:
 * it shows what the hotel already knows (passport, date of birth, visa),
 * each with a Copy button for pasting into the site, says what is still to
 * be asked, and records the FRRO number once it is filed.
 */

const LABELS = {
  passport_number: "Passport",
  date_of_birth: "Born",
  passport_expiry: "Passport expires",
  visa_number: "Visa",
  visa_expiry: "Visa expires",
  arrived_in_india: "Arrived in India",
  arrived_from: "Arrived from",
  next_destination: "Going next to",
  purpose: "Purpose",
  address_abroad: "Address abroad",
};

const DATES = new Set(["date_of_birth", "passport_expiry", "visa_expiry", "arrived_in_india"]);

function shown(field, value) {
  if (DATES.has(field)) return longDate(value);
  if (field === "purpose") return FORM_C_PURPOSES.find((p) => p.id === value)?.label || value;
  return value;
}

function Known({ row, onCopy }) {
  const known = Object.keys(LABELS).filter((f) => row[f]);
  const ask = FORM_C_REQUIRED.filter((f) => !row[f]).map((f) => (LABELS[f] || f).toLowerCase());
  return (
    <div className="space-y-1" style={{ minWidth: 260 }}>
      {known.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {known.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 text-sm">
              <span className="muted">{LABELS[f]}</span> {shown(f, row[f])}
              <button type="button" className="btn btn-ghost text-xs" style={{ padding: "0 0.4rem" }} onClick={() => onCopy(shown(f, row[f]))}>
                Copy
              </button>
            </span>
          ))}
        </div>
      )}
      {ask.length > 0 && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          Ask the guest: {ask.join(", ")}
        </div>
      )}
    </div>
  );
}

function Filing({ row, onFiled, busy }) {
  if (row.submittedAt) {
    return (
      <div className="space-y-1">
        <div style={{ color: "var(--accent-text)" }} title={row.submittedBy ? `Marked by ${row.submittedBy}` : undefined}>
          Filed {longDate(row.submittedAt)}
          {row.frro_reference ? `, ${row.frro_reference}` : ""}
        </div>
        <button type="button" className="btn btn-ghost text-xs" onClick={() => onFiled(row, false)} disabled={busy}>
          Mark not filed
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div style={{ color: row.overdue ? "var(--danger)" : "var(--warn)" }}>
        {row.overdue ? "Overdue since" : "Due by"} {longDate(row.dueAt)} {timeOf(row.dueAt)}
      </div>
      <button type="button" className="btn btn-secondary text-xs" onClick={() => onFiled(row, true)} disabled={busy}>
        Mark filed
      </button>
    </div>
  );
}

export default function FormCTab({ session, range, onOpen }) {
  const propertyId = session?.propertyId || null;
  const toast = useToast();
  const dialog = useDialog();
  const { report, loading, error, reload } = useReport("/api/reports/formc", range, propertyId);
  const [busy, setBusy] = useState(false);

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(String(text));
      toast("Copied.");
    } catch {
      toast("Could not copy. Select the text and copy it instead.", { tone: "error" });
    }
  }

  /** Filed needs the FRRO number, which is the proof it was filed. */
  async function markFiled(row, filed) {
    let frroReference;
    if (filed) {
      frroReference = await dialog.prompt({
        title: `Form C for ${row.name} filed?`,
        message: "Enter the application number the FRRO site gave you.",
        label: "FRRO number",
        value: row.frro_reference || "",
        confirmLabel: "Mark filed",
      });
      if (!frroReference) return;
    }
    setBusy(true);
    try {
      await sendJSON("/api/reports/formc", "PUT", {
        propertyId,
        reservationId: row.reservationId,
        personKey: row.personKey,
        submitted: filed,
        ...(filed ? { frroReference } : {}),
      });
      toast(filed ? `Form C for ${row.name} marked filed.` : `Form C for ${row.name} marked not filed.`);
      reload();
    } catch (err) {
      toast(err.message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const s = report?.summary;

  return (
    <div className="space-y-5">
      <Status loading={loading} error={error} report={report} />
      {report && !report.ready && <div className="card card-pad text-sm">Form C is not switched on yet. Ask your OnlineHotelier contact.</div>}
      {report?.ready && (
        <Section
          title="Foreign guests"
          sub="File each on the FRRO site within 24 hours of check-in, then mark it filed here."
          actions={
            <a className="btn btn-secondary text-sm" href={FRRO_FORM_C_URL} target="_blank" rel="noreferrer">
              Open the FRRO site
            </a>
          }
        >
          <Stats
            items={[
              { label: "Foreign guests", value: whole.format(s.guests) },
              { label: "Not filed", value: whole.format(s.guests - s.submitted), tone: s.guests - s.submitted > 0 ? "warn" : null },
              { label: "Overdue", value: whole.format(s.overdue), tone: s.overdue > 0 ? "danger" : null, hint: "Not filed within 24 hours of check-in" },
            ]}
          />
          {report.rows.length === 0 ? (
            <Empty>No foreign guests checked in on these dates.</Empty>
          ) : (
            <TableFrame tall>
              <table className="grid-table" style={{ opacity: loading ? 0.55 : 1 }}>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Checked in</th>
                    <th style={{ minWidth: 190 }}>Form C</th>
                    <th>What we know</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs muted">
                          {countryName(r.nationality) || "Nationality not set"}
                          {r.room ? `, room ${r.room}` : ""},{" "}
                          <BookingLink reference={r.reference} reservationId={r.reservationId} tab="guests" onOpen={onOpen} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {longDate(r.arrivalDay)}
                        {r.arrivedAt ? ` ${timeOf(r.arrivedAt)}` : ""}
                      </td>
                      <td>
                        <Filing row={r} onFiled={markFiled} busy={busy} />
                      </td>
                      <td>
                        <Known row={r} onCopy={copy} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </Section>
      )}
    </div>
  );
}
