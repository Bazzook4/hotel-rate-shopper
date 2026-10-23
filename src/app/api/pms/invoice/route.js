import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import { getReservationInvoice, getPropertyById } from "@/lib/database";
import { getHotelBrand } from "@/lib/hotelBrand";
import { DEFAULT_CURRENCY, moneyLocale } from "@/lib/money";
import { toCountryCode } from "@/lib/countries";

/**
 * An issued invoice as a PDF the desk can download, print or email.
 *
 * Drawn from the invoice's frozen `snapshot`, never from the live folio: the
 * PDF of INV-2026-0012 must say the same thing next year as on the day it was
 * issued, whatever has happened to the stay since.
 *
 * Built with pdf-lib's standard fonts, which carry no rupee glyph -- amounts
 * are written "INR 4,500.00", which is also how Indian tax invoices commonly
 * print them. Only Latin-1 survives those fonts, so every string is passed
 * through `plain` before it is drawn rather than letting one guest's name
 * with an unusual character fail the whole document.
 *
 * The hotel's logo is the one it has today, not frozen like the rest: it is
 * the hotel's look, not something the invoice states, and a replaced logo's
 * old file is deleted anyway.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4, in points
const MARGIN = 48;
const LOGO = { width: 120, height: 60 }; // the box a logo is scaled down to fit

function plain(value) {
  return String(value ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, "INR ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function money(value, currency = DEFAULT_CURRENCY) {
  const n = Number(value) || 0;
  return `${currency} ${n.toLocaleString(moneyLocale(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function day(iso) {
  if (!iso) return "-";
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
  );
}

/** Replace "night of 2026-09-26" with a readable date, for older and newer lines alike. */
function describe(line) {
  return plain(
    String(line.description || "").replace(/(\d{4}-\d{2}-\d{2})/g, (m) => day(m))
  );
}

/**
 * The hotel's logo ready to draw, or null. pdf-lib draws only PNG and JPG, so
 * a WebP logo is turned into a PNG first. A logo that cannot be had leaves the
 * invoice without one rather than failing it.
 */
async function loadLogo(pdf, url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
    const sharp = (await import("sharp")).default;
    return await pdf.embedPng(await sharp(bytes).png().toBuffer());
  } catch (err) {
    console.error("Invoice logo skipped:", err.message);
    return null;
  }
}

async function renderInvoice(invoice, fallbackProperty, logoUrl) {
  const snap = invoice.snapshot || {};
  // Invoices issued before taxes existed carry no `taxes`, and print as before.
  const taxes = snap.taxes || [];
  const currency = snap.currency || invoice.currency || "INR";
  const property = snap.property || fallbackProperty || {};

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${invoice.invoice_number}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf, logoUrl);

  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);
  const rule = rgb(0.82, 0.82, 0.85);

  const shade = rgb(0.94, 0.94, 0.96);

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const right = PAGE.width - MARGIN;
  const width = right - MARGIN;

  /** Draw at a given baseline; `text` below draws on the running `y`. */
  const put = (str, x, at, opts = {}) => {
    const f = opts.bold ? bold : font;
    const size = opts.size || 10;
    const s = plain(str);
    const left = opts.align === "right" ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: left, y: at, size, font: f, color: opts.color || ink });
  };
  const text = (str, x, opts = {}) => put(str, x, y, opts);

  /** Start a fresh page when the next block would run into the bottom margin. */
  const ensure = (needed) => {
    if (y - needed > MARGIN) return false;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
    return true;
  };

  /** Break a string into lines that fit `max` points; a word too long for a line is cut. */
  const wrap = (str, max, f, size) => {
    const out = [];
    let cur = "";
    for (const word of plain(str).split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) <= max) {
        cur = next;
        continue;
      }
      if (cur) out.push(cur);
      let w = word;
      while (w.length > 3 && f.widthOfTextAtSize(w, size) > max) w = `${w.slice(0, -4)}...`;
      cur = w;
    }
    if (cur) out.push(cur);
    return out.length > 0 ? out : [""];
  };

  const PAD = 6;
  const LEAD = 12;

  /**
   * A bordered table. `columns` are { label, width, align }, one of them may
   * leave out its width to take what is left. Each row is { cells, bold, fill }
   * and a cell is a string or a list of lines. A table that runs past the page
   * carries on with its header row repeated on the next one.
   */
  const table = (columns, rows, opts = {}) => {
    const x0 = opts.x ?? MARGIN;
    const total = opts.width ?? width;
    const fixed = columns.reduce((sum, c) => sum + (c.width || 0), 0);
    const widths = columns.map((c) => c.width || total - fixed);
    const size = opts.size || 9;

    const drawRow = (row) => {
      const f = row.bold ? bold : font;
      const lines = row.cells.map((cell, i) =>
        (Array.isArray(cell) ? cell : [cell])
          .filter((v) => v != null && v !== "")
          .flatMap((v) => wrap(v, widths[i] - PAD * 2, f, size))
      );
      const h = Math.max(1, ...lines.map((l) => l.length)) * LEAD + PAD;
      if (ensure(h) && !row.header && opts.header !== false) drawRow(headerRow);

      if (row.fill) page.drawRectangle({ x: x0, y: y - h, width: total, height: h, color: row.fill });
      page.drawRectangle({
        x: x0,
        y: y - h,
        width: total,
        height: h,
        borderColor: rule,
        borderWidth: 0.6,
      });
      let cx = x0;
      lines.forEach((cellLines, i) => {
        if (i > 0) {
          page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y - h }, thickness: 0.6, color: rule });
        }
        const alignRight = columns[i].align === "right";
        cellLines.forEach((l, n) => {
          put(l, alignRight ? cx + widths[i] - PAD : cx + PAD, y - PAD - size + 1 - n * LEAD, {
            size,
            bold: row.bold || (row.boldFirst && n === 0),
            color: row.header ? muted : ink,
            align: alignRight ? "right" : "left",
          });
        });
        cx += widths[i];
      });
      y -= h;
    };

    const headerRow = { cells: columns.map((c) => c.label), bold: true, fill: shade, header: true };
    if (opts.header !== false) drawRow(headerRow);
    rows.forEach(drawRow);
  };

  // ---- Header: logo and issuer on the left, the document's name on the right ----
  const top = y;
  let issuerX = MARGIN;
  let logoBottom = top;
  if (logo) {
    const scale = Math.min(LOGO.width / logo.width, LOGO.height / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.drawImage(logo, { x: MARGIN, y: top - h, width: w, height: h });
    issuerX = MARGIN + w + 14;
    logoBottom = top - h;
  }

  y = top - 14;
  text(property.name || "Invoice", issuerX, { bold: true, size: 16 });
  text(taxes.length > 0 ? "TAX INVOICE" : "INVOICE", right, {
    bold: true,
    size: 13,
    align: "right",
  });
  y -= 15;

  // India's tax number is the GSTIN; elsewhere it is simply the tax number.
  const taxIdLabel = (property.country_code || toCountryCode(property.country) || "IN") === "IN" ? "GSTIN" : "Tax ID";
  const issuerLines = [
    property.address,
    [property.city, property.state, property.postal_code].filter(Boolean).join(", "),
    property.country,
    [property.phone, property.email].filter(Boolean).join("  |  "),
    property.gstin ? `${taxIdLabel}: ${property.gstin}` : null,
  ].filter(Boolean);
  for (const l of issuerLines) {
    text(l, issuerX, { size: 9, color: muted });
    y -= 12;
  }
  y = Math.min(y, logoBottom) - 10;

  if (invoice.voided_at) {
    y -= 4;
    text(
      `VOID - ${day(invoice.voided_at)}${invoice.void_reason ? ` - ${invoice.void_reason}` : ""}`,
      MARGIN,
      { bold: true, size: 11, color: rgb(0.75, 0.1, 0.1) }
    );
    y -= 14;
  }

  // ---- Invoice, billed to and stay ----
  // Billed to a company, the invoice carries its name, address and GSTIN so
  // the company can claim the input credit, and names the guest who stayed.
  const bill = snap.bill_to;
  const guestLines = bill
    ? [
        bill.name,
        bill.address,
        [bill.city, bill.state, bill.postal_code].filter(Boolean).join(", "),
        bill.gstin ? `${taxIdLabel}: ${bill.gstin}` : null,
        `Guest: ${snap.guest_name}`,
      ]
    : [snap.guest_name, snap.guest_email, snap.guest_phone];
  const stayLines = [
    `${day(snap.check_in)} to ${day(snap.check_out)}`,
    [snap.room_type, snap.room_number ? `Room ${snap.room_number}` : null]
      .filter(Boolean)
      .join(", "),
    snap.rate_plan ? `Rate plan: ${snap.rate_plan}` : null,
    `${snap.adults ?? "-"} adult(s), ${snap.children ?? 0} child(ren)`,
  ];
  const docLines = [
    `No. ${invoice.invoice_number}`,
    `Issued ${day(invoice.issued_at)}`,
    `Booking ${snap.reference || "-"}`,
  ];

  table(
    [
      { label: "Invoice", width: 140 },
      { label: "Billed to" },
      { label: "Stay", width: 170 },
    ],
    [{ cells: [docLines, guestLines, stayLines], boldFirst: true }],
    { size: 9.5 }
  );

  y -= 16;

  // ---- Charges ----
  const lines = snap.lines || [];
  table(
    [
      { label: "#", width: 26, align: "right" },
      { label: "Description" },
      { label: "Qty", width: 42, align: "right" },
      { label: "Unit price", width: 96, align: "right" },
      { label: "Amount", width: 100, align: "right" },
    ],
    lines.map((l, i) => ({
      cells: [
        String(i + 1),
        describe(l),
        l.quantity != null ? String(l.quantity) : "",
        l.unit_price != null ? money(l.unit_price, currency) : "",
        money(l.amount, currency),
      ],
    }))
  );

  // ---- Totals, under the amounts ----
  const totals = snap.totals || {};
  // A split invoice carries only some of the stay's charges; a heading with
  // nothing under it would only make the reader look for what is missing.
  const totalRows = [
    ...(snap.split && !Number(totals.room) ? [] : [["Room", totals.room]]),
    ...(snap.split && !Number(totals.extras) ? [] : [["Extras", totals.extras]]),
    ...taxes.filter((t) => !t.inclusive).map((t) => [t.name, t.amount]),
    ["Total", totals.total, true],
    ...taxes.filter((t) => t.inclusive).map((t) => [`Includes ${t.name}`, t.amount]),
    ["Paid", totals.paid],
    ["Balance due", totals.balance, true],
  ];
  const totalsWidth = 238;
  table(
    [{ label: "" }, { label: "", width: 100, align: "right" }],
    totalRows.map(([label, value, strong]) => ({
      cells: [label, money(value, currency)],
      bold: strong,
      fill: strong ? shade : undefined,
    })),
    { x: right - totalsWidth, width: totalsWidth, header: false, size: 9.5 }
  );

  // ---- Payments received ----
  if ((snap.payments || []).length > 0) {
    y -= 18;
    ensure(60);
    text("Payments received", MARGIN, { bold: true, size: 10 });
    y -= 8;
    table(
      [
        { label: "Date", width: 90 },
        { label: "Method", width: 110 },
        { label: "Reference" },
        { label: "Amount", width: 100, align: "right" },
      ],
      snap.payments.map((p) => ({
        cells: [
          day(p.paid_at),
          String(p.method || "").replace(/_/g, " "),
          p.reference || "",
          money(p.amount, currency),
        ],
      }))
    );
  }

  // ---- Footer on every page ----
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const s = plain(`${invoice.invoice_number}  -  page ${i + 1} of ${pages.length}`);
    pg.drawText(s, {
      x: PAGE.width / 2 - font.widthOfTextAtSize(s, 8) / 2,
      y: MARGIN / 2,
      size: 8,
      font,
      color: muted,
    });
  });

  return pdf.save();
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) {
    return NextResponse.json({ error: "Invoice id is required" }, { status: 400 });
  }

  try {
    const invoice = await getReservationInvoice(id);

    // An invoice is only downloadable by someone who may act on its property.
    const propertyId = await resolvePropertyId(session, invoice.property_id);
    if (!propertyId || propertyId !== invoice.property_id) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Invoices issued before the issuer was frozen into the snapshot fall back
    // to the property as it is now, which is the best that can be done for them.
    const fallback = invoice.snapshot?.property
      ? null
      : await getPropertyById(invoice.property_id).catch(() => null);

    const brand = await getHotelBrand(invoice.property_id).catch(() => null);

    const bytes = await renderInvoice(invoice, fallback, brand?.logoUrl);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        // `inline` shows it in the booking's preview or a new tab; otherwise it downloads.
        "Content-Disposition": `${
          req.nextUrl.searchParams.get("inline") ? "inline" : "attachment"
        }; filename="${invoice.invoice_number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
