import { notFound } from "next/navigation";
import { loadSite } from "@/lib/hotelSite";

export async function generateMetadata({ params }) {
  const view = await loadSite(decodeURIComponent((await params).key));
  return { title: view ? `Rooms | ${view.name}` : "Rooms" };
}

/** Rooms: every room type with its photos, a description and what is in it. */
export default async function SiteRooms({ params }) {
  const view = await loadSite(decodeURIComponent((await params).key));
  if (!view) notFound();
  return (
    <main className="site-section">
      <div className="site-wrap">
        <h2>Our rooms</h2>
        {view.rooms.length === 0 && <p className="site-muted">Our rooms will be listed here soon.</p>}
        {view.rooms.map((r) => (
          <article key={r.id} className="site-room">
            <div className="pics">
              {r.photos[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="cover" src={r.photos[0]} alt={r.name} loading="lazy" />
              ) : null}
              {r.photos.length > 1 && (
                <div className="row">
                  {r.photos.slice(1, 4).map((u) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={u} src={u} alt="" loading="lazy" />
                  ))}
                </div>
              )}
            </div>
            <div className="info">
              <h3>{r.name}</h3>
              {r.guests && <p className="site-muted">Up to {r.guests} {r.guests === 1 ? "guest" : "guests"}</p>}
              {r.description && <p>{r.description}</p>}
              {r.amenities.length > 0 && (
                <ul className="site-chips">
                  {r.amenities.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              {view.bookUrl && (
                <p style={{ marginTop: "auto" }}>
                  <a className="site-btn" href={view.bookUrl}>
                    Check rates and book
                  </a>
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
