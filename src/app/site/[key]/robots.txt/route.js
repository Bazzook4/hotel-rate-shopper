import { loadSite, siteOrigin } from "@/lib/hotelSite";

/** Lets search engines in and points them to the sitemap. On a hotel's own domain this answers at /robots.txt. */
export async function GET(_request, { params }) {
  const key = decodeURIComponent((await params).key);
  if (!(await loadSite(key))) return new Response("Not found", { status: 404 });
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${await siteOrigin(key)}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
