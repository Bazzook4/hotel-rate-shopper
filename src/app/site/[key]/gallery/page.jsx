import { notFound } from "next/navigation";
import { loadSite } from "@/lib/hotelSite";
import Photos from "./Photos";

export async function generateMetadata({ params }) {
  const view = await loadSite(decodeURIComponent((await params).key));
  return { title: view ? `Gallery | ${view.name}` : "Gallery" };
}

/** Gallery: all the hotel's photos, tap one to see it large. */
export default async function SiteGallery({ params }) {
  const view = await loadSite(decodeURIComponent((await params).key));
  if (!view) notFound();
  return (
    <main className="site-section">
      <div className="site-wrap">
        <h2>Gallery</h2>
        {view.gallery.length === 0 ? <p className="site-muted">Photos will be added soon.</p> : <Photos photos={view.gallery} name={view.name} />}
      </div>
    </main>
  );
}
