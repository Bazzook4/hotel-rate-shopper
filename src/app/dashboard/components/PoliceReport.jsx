"use client";

import Icon from "../../components/Icon";
import { countryName } from "@/lib/countries";
import {
  BookingLink,
  Empty,
  PageHeader,
  PeriodPicker,
  Section,
  Stats,
  Status,
  TableFrame,
  downloadCsv,
  longDate,
  timeOf,
  useBookingOpener,
  usePeriod,
  useReport,
  whole,
} from "./reportKit";
import { useState } from "react";
import { SortTh, useSort } from "./useSort";
import FormCTab from "./FormC";
import { useToast } from "../../components/Toast";

/**
 * Police & Form C: the guest register the local police ask hotels to keep and
 * hand in, one line per person who checked in, with their ID, address and
 * nationality.
 *
 * Built from the bookings, so nobody copies names into a book. What is
 * missing is marked on the line, and the booking opens on its Guests tab,
 * where it is filled in. Printed or downloaded as it stands.
 *
 * Foreign guests' Form C is the same list cut to foreign guests, so it is a
 * second tab here rather than its own page. The tab only shows for a hotel
 * that has had a foreign guest in the last 90 days.
 */

const SORT = {
  arrived: (p) => p.arrivedAt || p.arrivalDay,
  room: (p) => String(p.room || ""),
  name: (p) => String(p.name || "").toLowerCase(),
  nationality: (p) => countryName(p.nationality) || "",
};

function arrivedText(p) {
  return `${longDate(p.arrivalDay)}${p.arrivedAt ? ` ${timeOf(p.arrivedAt)}` : ""}`;
}

/** The rows as the printed and downloaded register have them. */
function registerRows(people) {
  return people.map((p, i) => [
    i + 1,
    arrivedText(p),
    p.room || "",
    p.name || "",
    p.gender || "",
    p.dateOfBirth ? longDate(p.dateOfBirth) : "",
    countryName(p.nationality) || "",
    p.phone || "",
    p.address || "",
    p.idLabel || "",
    p.idNumber || "",
    longDate(p.checkOut),
    p.reference || "",
  ]);
}

const HEAD = ["No.", "Arrived", "Room", "Name", "Gender", "Date of birth", "Nationality", "Phone", "Address", "ID type", "ID number", "Leaves", "Booking"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A plain page of the register, opened and sent to the printer. */
function printRegister(report, hotel) {
  const win = window.open("", "_blank");
  if (!win) return false;
  const period = report.start === report.end ? longDate(report.start) : `${longDate(report.start)} to ${longDate(report.end)}`;
  const rows = registerRows(report.people)
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Guest register, ${esc(period)}</title>
<style>
body{font:12px/1.4 Arial,sans-serif;margin:24px;color:#000}
h1{font-size:18px;margin:0}
p{margin:2px 0 12px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#eee}
.sign{margin-top:40px;display:flex;justify-content:space-between}
@page{size:landscape;margin:12mm}
</style></head><body>
<h1>${esc(hotel || "Guest register")}</h1>
<p>Guest register: guests checked in ${esc(period)}. ${report.people.length} guest${report.people.length === 1 ? "" : "s"}.</p>
<table><thead><tr>${HEAD.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${HEAD.length}">No guests checked in.</td></tr>`}</tbody></table>
<div class="sign"><span>Printed ${esc(`${longDate(new Date().toISOString())} ${timeOf(new Date().toISOString())}`)}</span><span>Signature of manager: ____________________</span></div>
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  return true;
}

function exportCsv(report) {
  const r = [["Guest register", report.start, report.end], [], HEAD, ...registerRows(report.people)];
  downloadCsv(`guest-register-${report.start}-to-${report.end}.csv`, r);
}

function ShortStays({ report, onOpen }) {
  if (report.shortStays.length === 0) return null;
  return (
    <Section title="Adults not named" sub="These bookings have more adults than named guests. Add each adult on the booking's Guests tab.">
      <TableFrame>
        <table className="grid-table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Booked by</th>
              <th>Room</th>
              <th className="text-right">Adults</th>
              <th className="text-right">Named</th>
            </tr>
          </thead>
          <tbody>
            {report.shortStays.map((s) => (
              <tr key={s.reservationId}>
                <td>
                  <BookingLink reference={s.reference} reservationId={s.reservationId} tab="guests" onOpen={onOpen} />
                </td>
                <td>{s.bookingName || "-"}</td>
                <td>{s.room || "-"}</td>
                <td className="text-right tabular-nums">{s.adults}</td>
                <td className="text-right tabular-nums">{s.named}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </Section>
  );
}

function Register({ report, onOpen }) {
  const sorter = useSort(report.people, SORT);
  return (
    <Section title="Guest register" sub="Click a booking to fill in what is missing.">
      {sorter.rows.length === 0 ? (
        <Empty>No guests checked in on these dates.</Empty>
      ) : (
        <TableFrame tall>
          <table className="grid-table">
            <thead>
              <tr>
                <SortTh sorter={sorter} col="arrived">Arrived</SortTh>
                <SortTh sorter={sorter} col="room">Room</SortTh>
                <SortTh sorter={sorter} col="name">Name</SortTh>
                <th>Gender</th>
                <SortTh sorter={sorter} col="nationality">Nationality</SortTh>
                <th>Phone</th>
                <th>ID</th>
                <th>Address</th>
                <th>Leaves</th>
                <th>Booking</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {sorter.rows.map((p) => (
                <tr key={`${p.reservationId}|${p.key}`}>
                  <td className="whitespace-nowrap">{arrivedText(p)}</td>
                  <td>{p.room || "-"}</td>
                  <td className="font-medium">
                    {p.name || "-"}
                    {p.foreign && (
                      <span className="chip chip-off ml-2" title="Needs Form C">
                        Foreign
                      </span>
                    )}
                  </td>
                  <td>{p.gender || "-"}</td>
                  <td>{countryName(p.nationality) || "-"}</td>
                  <td className="whitespace-nowrap">{p.phone || "-"}</td>
                  <td className="whitespace-nowrap">{p.idNumber ? `${p.idLabel || "ID"} ${p.idNumber}` : "-"}</td>
                  <td style={{ minWidth: 180 }}>{p.address || "-"}</td>
                  <td className="whitespace-nowrap">{longDate(p.checkOut)}</td>
                  <td>
                    <BookingLink reference={p.reference} reservationId={p.reservationId} tab="guests" onOpen={onOpen} />
                  </td>
                  <td style={{ color: p.gaps.length ? "var(--warn)" : "var(--text-muted)" }}>
                    {p.gaps.length ? p.gaps.join(", ") : "Complete"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Section>
  );
}

export default function PoliceReport({ session, initialView }) {
  const propertyId = session?.propertyId || null;
  const period = usePeriod("today");
  const { report, loading, error, reload } = useReport("/api/reports/police", period.valid ? period.range : null, propertyId);
  const { openBooking, modal } = useBookingOpener(session, reload);
  const toast = useToast();
  const [view, setView] = useState(initialView === "formc" ? "formc" : "register");
  const showFormC = view === "formc" || Boolean(report?.foreignRecently);
  const s = report?.summary;
  const blocked = !report || loading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Police & Form C"
        blurb="Guests checked in, with ID, address and nationality, ready to print."
        actions={
          view === "register" ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary text-sm" onClick={() => exportCsv(report)} disabled={blocked}>
              <Icon name="download" size={14} />
              Download CSV
            </button>
            <button
              type="button"
              className="btn btn-primary text-sm"
              onClick={() => {
                if (!printRegister(report, session?.propertyName)) {
                  toast("Your browser blocked the print window. Allow pop-ups for this site and try again.", { tone: "error" });
                }
              }}
              disabled={blocked}
            >
              Print
            </button>
          </div>
          ) : null
        }
      />

      <div className="card card-pad">
        <PeriodPicker id="police" label="Checked in between" {...period} />
        {!period.valid && (
          <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
            The end date is before the start date.
          </p>
        )}
      </div>

      {showFormC && (
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={view === "register"} className={view === "register" ? "seg-on" : ""} onClick={() => setView("register")}>
            All guests
          </button>
          <button type="button" role="tab" aria-selected={view === "formc"} className={view === "formc" ? "seg-on" : ""} onClick={() => setView("formc")}>
            Foreign guests, Form C
          </button>
        </div>
      )}

      {view === "formc" && <FormCTab session={session} range={period.valid ? period.range : null} onOpen={openBooking} />}

      {view === "register" && <Status loading={loading} error={error} report={report} />}

      {view === "register" && report && (
        <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <div className="card card-pad">
            <Stats
              items={[
                { label: "Check-ins", value: whole.format(s.stays) },
                { label: "Guests listed", value: whole.format(s.people) },
                { label: "Foreign guests", value: whole.format(s.foreign), hint: "Each needs a Form C" },
                {
                  label: "Missing details",
                  value: whole.format(s.incomplete),
                  tone: s.incomplete > 0 ? "warn" : null,
                  hint: "Guests with no ID, address or nationality on record",
                },
              ]}
            />
          </div>
          <ShortStays report={report} onOpen={openBooking} />
          <Register report={report} onOpen={openBooking} />
        </div>
      )}

      {modal}
    </div>
  );
}
