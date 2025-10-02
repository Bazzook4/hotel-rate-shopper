import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q") || "";
    const check_in_date = searchParams.get("check_in_date");
    const check_out_date = searchParams.get("check_out_date");
    const adults = searchParams.get("adults") || "2";
    const children = searchParams.get("children") || "0";
    const currency = searchParams.get("currency") || "INR";
    const ll = searchParams.get("ll");              // optional "lat,lng"
    const overrideKey = searchParams.get("api_key");

    const apiKey = overrideKey || process.env.SERPAPI_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing SERPAPI key" }, { status: 400 });
    }

    const serp = new URL("https://serpapi.com/search.json");
    serp.searchParams.set("engine", "google_hotels");
    serp.searchParams.set("q", q);
    serp.searchParams.set("check_in_date", check_in_date);
    serp.searchParams.set("check_out_date", check_out_date);
    serp.searchParams.set("adults", adults);
    serp.searchParams.set("children", children);
    serp.searchParams.set("currency", currency);
    serp.searchParams.set("gl", "in");
    serp.searchParams.set("hl", "en");
    if (ll) serp.searchParams.set("ll", ll);
    serp.searchParams.set("api_key", apiKey);

    const res = await fetch(serp, { cache: "no-store" });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || "SerpAPI error", raw: data },
        { status: res.status }
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}