import { NextResponse } from "next/server";
import { fetchHotel, isScraperConfigured, sessionIdFor } from "@/lib/scraper/fetch";

/**
 * Ad-hoc hotel lookup, kept for manual checks and debugging.
 *
 * Reads Google's own page rather than SerpAPI, but still answers in SerpAPI's
 * response shape so anything pointed at this route keeps working.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q") || "";
    if (!q) {
      return NextResponse.json({ error: "Missing q" }, { status: 400 });
    }

    if (!isScraperConfigured()) {
      return NextResponse.json(
        { error: "Rate shopping is not configured." },
        { status: 503 }
      );
    }

    const data = await fetchHotel(q, {
      checkIn: searchParams.get("check_in_date"),
      checkOut: searchParams.get("check_out_date"),
      adults: Number(searchParams.get("adults")) || 2,
      currency: searchParams.get("currency") || "INR",
      sessionId: sessionIdFor(q),
    });

    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error(e);
    // A refusal or a layout change is the caller's business, not a generic
    // 500: one means back off, the other means the parser needs updating.
    const status = e.code === "blocked" || e.code === "consent_wall" ? 429 : 502;
    return NextResponse.json({ error: e.message, code: e.code || null }, { status });
  }
}
