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
  const { details, show } = view;
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

      {show.about && details.about && (
        <section className="site-section site-center" id="about">
          <div className="site-wrap">
            <p className="site-eyebrow">Welcome</p>
            <h2>{view.name}</h2>
            <p className="site-about">{details.about}</p>
            {!show.info && (details.checkIn || details.checkOut) && (
              <p className="site-muted">
                {details.checkIn && `Check-in from ${timeLabel(details.checkIn)}`}
                {details.checkIn && details.checkOut && ". "}
                {details.checkOut && `Check-out by ${timeLabel(details.checkOut)}`}.
              </p>
            )}
          </div>
        </section>
      )}

      {show.amenities && details.amenities.length > 0 && (
        <section className="site-section site-band site-center" id="amenities" style={{ padding: "2.5rem 0" }}>
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
        <section className="site-section site-center" id="rooms">
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
      {show.info && view.info.length > 0 && (
        <section className="site-section site-center" id="info">
          <div className="site-wrap">
            <p className="site-eyebrow">Good to know</p>
            <h2>Hotel information</h2>
            <dl className="site-dl site-facts">
              {view.info.map((r) => (
                <div key={r.label} style={{ display: "contents" }}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {show.location && (details.address || view.reach) && (
        <section className="site-section site-band site-center" id="location">
          <div className="site-wrap">
            <p className="site-eyebrow">Find us</p>
            <h2>Location</h2>
            {details.address && <p className="site-about">{details.address}</p>}
            {view.reach && <p className="site-muted site-about">{view.reach}</p>}
            {view.mapEmbed && (
              <iframe
                className="site-map"
                title={`Map of ${view.name}`}
                src={view.mapEmbed}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            )}
            {details.mapUrl && (
              <p className="site-actions">
                <a className="site-btn site-btn-line" href={details.mapUrl} target="_blank" rel="noreferrer">
                  Get directions
                </a>
              </p>
            )}
          </div>
        </section>
      )}

      {show.faq && view.faqs.length > 0 && (
        <section className="site-section site-center" id="faq">
          <div className="site-wrap">
            <p className="site-eyebrow">Questions</p>
            <h2>Frequently asked questions</h2>
            <div className="site-faq">
              {view.faqs.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
