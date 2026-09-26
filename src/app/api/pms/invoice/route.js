import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { getReservationInvoice, getPropertyById } from "@/lib/database";

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
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4, in points
const MARGIN = 48;

function plain(value) {
  return String(value ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, "INR ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function money(value, currency = "INR") {
  const n = Number(value) || 0;
  return `${currency} ${n.toLocaleString("en-IN", {
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

async function renderInvoice(invoice, fallbackProperty) {
  const snap = invoice.snapshot || {};
  const currency = snap.currency || invoice.currency || "INR";
  const property = snap.property || fallbackProperty || {};

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${invoice.invoice_number}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);
  const rule = rgb(0.82, 0.82, 0.85);

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const right = PAGE.width - MARGIN;

  const text = (str, x, opts = {}) => {
    const f = opts.bold ? bold : font;
    const size = opts.size || 10;
    const s = plain(str);
    const at = opts.align === "right" ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: at, y, size, font: f, color: opts.color || ink });
  };

  const line = (from = MARGIN, to = right) => {
    page.drawLine({
      start: { x: from, y },
      end: { x: to, y },
      thickness: 0.6,
      color: rule,
    });
  };

  /** Start a fresh page when the next row would run into the bottom margin. */
  const ensure = (needed) => {
    if (y - needed > MARGIN) return;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };

  // ---- Header: issuer on the left, the document on the right ----
  text(property.name || "Invoice", MARGIN, { bold: true, size: 16 });
  text("TAX INVOICE", right, { bold: true, size: 12, align: "right" });
  y -= 16;

  const issuerLines = [
    property.address,
    [property.city, property.state, property.postal_code].filter(Boolean).join(", "),
    property.country,
    [property.phone, property.email].filter(Boolean).join("  |  "),
  ].filter(Boolean);

  const docLines = [
    `Invoice no. ${invoice.invoice_number}`,
    `Issued ${day(invoice.issued_at)}`,
    `Booking ${snap.reference || "-"}`,
  ];

  for (let i = 0; i < Math.max(issuerLines.length, docLines.length); i += 1) {
    if (issuerLines[i]) text(issuerLines[i], MARGIN, { size: 9, color: muted });
    if (docLines[i]) text(docLines[i], right, { size: 9, color: muted, align: "right" });
    y -= 12;
  }

  if (invoice.voided_at) {
    y -= 4;
    text(
      `VOID - ${day(invoice.voided_at)}${invoice.void_reason ? ` - ${invoice.void_reason}` : ""}`,
      MARGIN,
      { bold: true, size: 11, color: rgb(0.75, 0.1, 0.1) }
    );
    y -= 14;
  }

  y -= 8;
  line();
  y -= 18;

  // ---- Guest and stay ----
  const col2 = MARGIN + (right - MARGIN) / 2;
  text("Billed to", MARGIN, { bold: true, size: 9, color: muted });
  text("Stay", col2, { bold: true, size: 9, color: muted });
  y -= 13;

  const guestLines = [snap.guest_name, snap.guest_email, snap.guest_phone].filter(Boolean);
  const stayLines = [
    `${day(snap.check_in)} to ${day(snap.check_out)}`,
    [snap.room_type, snap.room_number ? `Room ${snap.room_number}` : null]
      .filter(Boolean)
      .join(", "),
    snap.rate_plan ? `Rate plan: ${snap.rate_plan}` : null,
    `${snap.adults ?? "-"} adult(s), ${snap.children ?? 0} child(ren)`,
  ].filter(Boolean);

  for (let i = 0; i < Math.max(guestLines.length, stayLines.length); i += 1) {
    if (guestLines[i]) text(guestLines[i], MARGIN, { size: 10, bold: i === 0 });
    if (stayLines[i]) text(stayLines[i], col2, { size: 10 });
    y -= 13;
  }

  y -= 12;

  // ---- Lines ----
  const cols = { qty: right - 190, unit: right - 100, amount: right };

  const header = () => {
    text("Description", MARGIN, { bold: true, size: 9, color: muted });
    text("Qty", cols.qty, { bold: true, size: 9, color: muted, align: "right" });
    text("Unit price", cols.unit, { bold: true, size: 9, color: muted, align: "right" });
    text("Amount", cols.amount, { bold: true, size: 9, color: muted, align: "right" });
    y -= 6;
    line();
    y -= 13;
  };
  header();

  for (const l of snap.lines || []) {
    ensure(20);
    // Long descriptions are cut to the column rather than drawn over the numbers.
    let desc = describe(l);
    const maxWidth = cols.qty - 40 - MARGIN;
    while (desc.length > 3 && font.widthOfTextAtSize(desc, 10) > maxWidth) {
      desc = `${desc.slice(0, -4)}...`;
    }
    text(desc, MARGIN);
    if (l.quantity != null) text(String(l.quantity), cols.qty, { align: "right" });
    if (l.unit_price != null) text(money(l.unit_price, currency), cols.unit, { align: "right" });
    text(money(l.amount, currency), cols.amount, { align: "right" });
    y -= 15;
  }

  y -= 2;
  line();
  y -= 16;

  // ---- Totals ----
  const totals = snap.totals || {};
  const totalRows = [
    ["Room", totals.room],
    ["Extras", totals.extras],
    ["Total", totals.total, true],
    ["Paid", totals.paid],
    ["Balance due", totals.balance, true],
  ];
  for (const [label, value, strong] of totalRows) {
    ensure(18);
    text(label, cols.unit, { bold: strong, align: "right", size: strong ? 11 : 10 });
    text(money(value, currency), cols.amount, {
      bold: strong,
      align: "right",
      size: strong ? 11 : 10,
    });
    y -= strong ? 17 : 14;
  }

  // ---- Payments received ----
  if ((snap.payments || []).length > 0) {
    y -= 12;
    ensure(40);
    text("Payments received", MARGIN, { bold: true, size: 9, color: muted });
    y -= 6;
    line();
    y -= 13;
    for (const p of snap.payments) {
      ensure(16);
      const label = [day(p.paid_at), String(p.method || "").replace(/_/g, " "), p.reference]
        .filter(Boolean)
        .join("  |  ");
      text(label, MARGIN, { size: 9 });
      text(money(p.amount, currency), cols.amount, { size: 9, align: "right" });
      y -= 13;
    }
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
  const { error, session } = await pmsGuard(req);
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

    const bytes = await renderInvoice(invoice, fallback);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
