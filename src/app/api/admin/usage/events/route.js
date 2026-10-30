import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/serverSession";
import { isSuperAdmin } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/database";
import { MODULES } from "@/app/dashboard/modules";
import { TOURS } from "@/lib/tours";

/**
 * How the app is used once open, for the super admin (Admin > Usage): per
 * page, how often it is opened, how long people stay, how often they leave
 * without pressing anything and what they press; then whether Show me how,
 * the guides, Help on WhatsApp and Ctrl+K get used. From page_opens (042)
 * and usage_events (061); super admin visits are left out.
 *
 * ?days=7|30|90 (30 by default) and ?property=<id> for one hotel.
 */

const PAGE = 1000;
const DAY = 24 * 60 * 60 * 1000;
// Under this, with no click, a visit counts as left straight away.
const FAST_SECONDS = 10;
const TOP_CLICKS = 6;

async function allRows(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session || !isSuperAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const property = url.searchParams.get("property") || null;
  const since = new Date(Date.now() - (days - 1) * DAY).toISOString().slice(0, 10);

  const supabase = getSupabaseAdmin();
  const scoped = (q) => {
    q = q.neq("role", "SuperAdmin");
    return property ? q.eq("property_id", property) : q;
  };

  let opens, events;
  try {
    [opens, events] = await Promise.all([
      allRows(() =>
        scoped(supabase.from("page_opens").select("id, page_id, property_id").gte("opened_on", since)).order("id")
      ),
      allRows(() =>
        scoped(
          supabase
            .from("usage_events")
            .select("id, page_id, property_id, kind, target, value, clicks")
            .gte("happened_on", since)
        ).order("id")
      ),
    ]);
  } catch (e) {
    // Until migration 061 is run the table is missing: say so plainly.
    const missing = /usage_events/.test(e.message || "") && /exist|schema cache/i.test(e.message || "");
    return NextResponse.json(
      { error: missing ? "Click tracking is not switched on yet: run migration 061." : e.message },
      { status: 500 }
    );
  }

  const pages = new Map(
    MODULES.map((m) => [
      m.id,
      { id: m.id, label: m.label, opens: 0, hotels: new Set(), seconds: [], visits: 0, fast: 0, idle: 0, help: 0, clicks: new Map() },
    ])
  );
  for (const o of opens) {
    const p = pages.get(o.page_id);
    if (!p) continue;
    p.opens += 1;
    if (o.property_id) p.hotels.add(o.property_id);
  }

  const tours = new Map(
    TOURS.map((t) => [t.id, { id: t.id, title: t.title, started: 0, done: 0, quit: 0, quitSteps: [] }])
  );
  const totals = { guide: 0, palette: 0, paletteGo: 0, help: 0, feedback: 0 };

  for (const e of events) {
    const p = pages.get(e.page_id);
    if (e.kind === "visit" && p) {
      p.visits += 1;
      p.seconds.push(e.value || 0);
      if (!e.clicks) {
        p.idle += 1;
        if ((e.value || 0) < FAST_SECONDS) p.fast += 1;
      }
    } else if (e.kind === "click" && e.target) {
      if (e.target === "Help on WhatsApp") {
        totals.help += 1;
        if (p) p.help += 1;
      } else if (e.target === "Feedback on WhatsApp") {
        totals.feedback += 1;
      } else if (p && e.target !== "Show me how") {
        p.clicks.set(e.target, (p.clicks.get(e.target) || 0) + 1);
      }
    } else if (e.kind === "guide") {
      totals.guide += 1;
    } else if (e.kind === "palette") {
      totals.palette += 1;
    } else if (e.kind === "palette_go") {
      totals.paletteGo += 1;
    } else if (e.kind.startsWith("tour")) {
      const t = tours.get(e.target);
      if (!t) continue;
      if (e.kind === "tour") t.started += 1;
      else if (e.kind === "tour_done") t.done += 1;
      else if (e.kind === "tour_quit") {
        t.quit += 1;
        if (e.value != null) t.quitSteps.push(e.value);
      }
    }
  }

  const pageRows = [...pages.values()].map((p) => ({
    id: p.id,
    label: p.label,
    opens: p.opens,
    hotels: p.hotels.size,
    visits: p.visits,
    median_seconds: median(p.seconds),
    left_fast: p.fast,
    no_click: p.idle,
    help: p.help,
    top_clicks: [...p.clicks.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CLICKS)
      .map(([label, count]) => ({ label, count })),
  }));

  const tourRows = [...tours.values()].map((t) => ({
    id: t.id,
    title: t.title,
    started: t.started,
    done: t.done,
    quit: t.quit,
    quit_step: median(t.quitSteps),
    steps: TOURS.find((x) => x.id === t.id)?.steps.length ?? null,
  }));

  return NextResponse.json({ days, since, pages: pageRows, tours: tourRows, totals });
}
