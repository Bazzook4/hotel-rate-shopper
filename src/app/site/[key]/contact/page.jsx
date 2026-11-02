import { notFound } from "next/navigation";
import { loadSite, siteMeta } from "@/lib/hotelSite";
import { timeLabel } from "@/lib/bookingEngineShared";

export async function generateMetadata({ params }) {
  const key = decodeURIComponent((await params).key);
  const view = await loadSite(key);
  if (!view) return siteMeta(key, {});
  return siteMeta(key, {
    path: "/contact",
    title: `Contact us | ${view.name}`,
    description: `Address, phone and email of ${view.name}${view.city ? `, ${view.city}` : ""}, with check-in and check-out times and directions.`,
  });
}

/** Contact us: where the hotel is, how to reach it, arrival times and house rules. */
export default async function SiteContact({ params }) {
  const view = await loadSite(decodeURIComponent((await params).key));
  if (!view) notFound();
  const d = view.details;
  const rows = [
    d.address && ["Address", d.address],
    d.phone && ["Phone", <a key="p" href={`tel:${d.phone}`}>{d.phone}</a>],
    d.email && ["Email", <a key="e" href={`mailto:${d.email}`}>{d.email}</a>],
    d.checkIn && ["Check-in", `From ${timeLabel(d.checkIn)}`],
    d.checkOut && ["Check-out", `By ${timeLabel(d.checkOut)}`],
    d.rules && ["House rules", d.rules],
  ].filter(Boolean);
  return (
    <main className="site-section">
      <div className="site-wrap">
        <h1>Contact us</h1>
        {rows.length === 0 ? (
          <p className="site-muted">Contact details will be added soon.</p>
        ) : (
          <dl className="site-dl">
            {rows.map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p style={{ marginTop: "1.5rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
          {d.mapUrl && (
            <a className="site-btn site-btn-line" href={d.mapUrl} target="_blank" rel="noreferrer">
              Get directions
            </a>
          )}
          {d.phone && (
            <a className="site-btn site-btn-line" href={`tel:${d.phone}`}>
              Call us
            </a>
          )}
          {view.bookUrl && (
            <a className="site-btn" href={view.bookUrl}>
              Book your stay
            </a>
          )}
        </p>
      </div>
    </main>
  );
}
