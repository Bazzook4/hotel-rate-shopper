import { loadSite, siteOrigin } from "@/lib/hotelSite";

/** The site's pages, for search engines. On a hotel's own domain this answers at /sitemap.xml. */
export async function GET(_request, { params }) {
  const key = decodeURIComponent((await params).key);
  if (!(await loadSite(key))) return new Response("Not found", { status: 404 });
  const origin = await siteOrigin(key);
  const pages = ["", "/rooms", "/gallery", "/contact"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${origin}${p}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
