import { notFound } from "next/navigation";
import { loadSite, siteBase } from "@/lib/hotelSite";
import { timeLabel } from "@/lib/bookingEngineShared";
import { RoomCard } from "./Rooms";

/** Home: the hotel's photo and name, a few words about it, what it offers, and a taste of the rooms. */
export default async function SiteHome({ params }) {
  const { key } = await params;
  const view = await loadSite(decodeURIComponent(key));
  if (!view) notFound();
  const base = await siteBase(key);
  const { details } = view;
  const hero = view.banner[0] || view.gallery[0];
  return (
    <main>
      <section className={`site-hero${hero ? "" : " plain"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {hero && <img className="bg" src={hero} alt="" />}
        <div className="copy">
          <h1>{view.name}</h1>
          {view.tagline && <p>{view.tagline}</p>}
          <div className="site-actions">
            {view.bookUrl && (
              <a className="site-btn" href={view.bookUrl}>
                Book your stay
              </a>
            )}
            <a className="site-btn site-btn-light" href={`${base}/rooms`}>
              See our rooms
            </a>
          </div>
        </div>
      </section>

      {details.about && (
        <section className="site-section site-center">
          <div className="site-wrap">
            <p className="site-eyebrow">Welcome</p>
            <h2>{view.name}</h2>
            <p className="site-about">{details.about}</p>
            {(details.checkIn || details.checkOut) && (
              <p className="site-muted">
                {details.checkIn && `Check-in from ${timeLabel(details.checkIn)}`}
                {details.checkIn && details.checkOut && ". "}
                {details.checkOut && `Check-out by ${timeLabel(details.checkOut)}`}.
              </p>
            )}
          </div>
        </section>
      )}

      {details.amenities.length > 0 && (
        <section className="site-section site-band site-center" style={{ padding: "2.5rem 0" }}>
          <div className="site-wrap">
            <p className="site-eyebrow">What we offer</p>
            <ul className="site-chips">
              {details.amenities.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {view.rooms.length > 0 && (
        <section className="site-section site-center">
          <div className="site-wrap">
            <p className="site-eyebrow">Stay with us</p>
            <h2>Rooms and suites</h2>
            <div className="site-grid">
              {view.rooms.slice(0, 3).map((r) => (
                <RoomCard key={r.id} room={r} />
              ))}
            </div>
            {view.rooms.length > 3 && (
              <p style={{ marginTop: "2rem" }}>
                <a className="site-btn site-btn-line" href={`${base}/rooms`}>
                  All {view.rooms.length} rooms
                </a>
              </p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
