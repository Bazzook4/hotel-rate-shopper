import { notFound } from "next/navigation";
import { loadSite, siteMeta } from "@/lib/hotelSite";
import Photos from "./Photos";

export async function generateMetadata({ params }) {
  const key = decodeURIComponent((await params).key);
  const view = await loadSite(key);
  if (!view) return siteMeta(key, {});
  return siteMeta(key, {
    path: "/gallery",
    title: `Gallery | ${view.name}`,
    description: `Photos of ${view.name}${view.city ? `, ${view.city}` : ""}: the hotel, the rooms and the stay.`,
    image: view.gallery[0],
  });
}

/** Gallery: all the hotel's photos, tap one to see it large. */
export default async function SiteGallery({ params }) {
  const view = await loadSite(decodeURIComponent((await params).key));
  if (!view) notFound();
  return (
    <main className="site-section">
      <div className="site-wrap">
        <h1>Gallery</h1>
        {view.gallery.length === 0 ? <p className="site-muted">Photos will be added soon.</p> : <Photos photos={view.gallery} name={view.name} />}
      </div>
    </main>
  );
}
