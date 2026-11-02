import { notFound } from "next/navigation";
import { loadSite, siteBase } from "@/lib/hotelSite";
import SiteNav from "./SiteNav";
import { Cormorant_Garamond } from "next/font/google";
import "../site.css";

const serif = Cormorant_Garamond({ variable: "--font-site-serif", subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"] });

/**
 * The hotel's website frame: its name, the four pages, and the contact line
 * at the bottom. On the hotel's own domain the pages sit at the root, so the
 * links are relative to wherever the middleware says the site is mounted.
 */

export async function generateMetadata({ params }) {
  const { key } = await params;
  const view = await loadSite(decodeURIComponent(key));
  if (!view) return { title: "Website not found" };
  return {
    title: view.tagline ? `${view.name} | ${view.tagline}` : view.name,
    description: view.details.about?.slice(0, 160) || view.tagline || view.name,
    openGraph: view.banner[0] ? { images: [view.banner[0]] } : undefined,
  };
}

export default async function SiteLayout({ children, params }) {
  const { key } = await params;
  const view = await loadSite(decodeURIComponent(key));
  if (!view) notFound();
  const base = await siteBase(key);
  const links = [
    { href: base || "/", label: "Home", match: "home" },
    { href: `${base}/rooms`, label: "Rooms", match: "rooms" },
    { href: `${base}/gallery`, label: "Gallery", match: "gallery" },
    { href: `${base}/contact`, label: "Contact us", match: "contact" },
  ];
  return (
    <div className={`site ${serif.variable}`}>
      <header className="site-head">
        <div className="site-wrap">
          <a className="site-brand" href={base || "/"}>
            {view.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={view.logoUrl} alt="" />}
            <span>{view.name}</span>
          </a>
          <SiteNav base={base} links={links} />
          {view.bookUrl && (
            <a className="site-btn" href={view.bookUrl}>
              Book now
            </a>
          )}
        </div>
      </header>
      {children}
      <footer className="site-foot">
        <div className="site-wrap">
          <span>
            {view.name}
            {view.details.address ? `, ${view.details.address}` : ""}
          </span>
          {view.details.phone && <a href={`tel:${view.details.phone}`}>{view.details.phone}</a>}
        </div>
      </footer>
    </div>
  );
}
