"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { visibleAreas, areaForPage, canOpenPage, PLACEHOLDER_PAGES } from "./dashboard/modules";
import AccountMenu from "./components/AccountMenu";
import ThemeToggle from "./components/ThemeToggle";
import SupportBar from "./components/SupportBar";
import Icon from "./components/Icon";
import { ToastProvider } from "./components/Toast";
import { DialogProvider } from "./components/Dialog";
import { PageNavProvider } from "./components/PageNav";
import Hint from "./components/Hint";
import PageErrorBoundary from "./components/PageErrorBoundary";
import CommandPalette from "./dashboard/components/CommandPalette";
import SetupBanner from "./dashboard/components/SetupBanner";
import BackToBooking from "./dashboard/components/BackToBooking";
import { useBookingOpener } from "./dashboard/components/reportKit";
import { RELEASE_NOTES } from "@/lib/releaseNotes";
import { useEscape } from "./components/useEscape";
import Select from "@/app/components/Select";
import { setHotelDayStart, setHotelZone } from "@/lib/hotelTime";
import { setHotelCurrency } from "@/lib/money";

/**
 * Each page is fetched the first time it is opened, not with the dashboard.
 *
 * Imported directly, every page -- the Channel Manager, the tape chart, the
 * reports and the charting library behind them -- was downloaded and parsed
 * before the first one could show, though a session opens only a few. Once
 * fetched a page is cached, so returning to it is immediate.
 */
function PageLoading() {
  // The outline of a page -- a title, then a card -- rather than a spinner,
  // so the page settles into place instead of jumping in.
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="skeleton" style={{ height: 24, width: 220 }} />
        <div className="skeleton" style={{ height: 14, width: 320, maxWidth: "80%" }} />
      </div>
      <div className="card card-pad space-y-3">
        {[90, 75, 85, 60].map((w, i) => (
          <div key={i} className="skeleton" style={{ height: 16, width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

const TodayPage = dynamic(() => import("./dashboard/components/TodayPage"), {
  ssr: false,
  loading: PageLoading,
});
const BookingTour = dynamic(() => import("./dashboard/components/BookingTour"), { ssr: false });
const TourGuide = dynamic(() => import("./dashboard/components/TourGuide"), { ssr: false });
const Explore = dynamic(() => import("./dashboard/components/Explore"), {
  ssr: false,
  loading: PageLoading,
});
const ChannelManager = dynamic(() => import("./dashboard/components/ChannelManager"), {
  ssr: false,
  loading: PageLoading,
});
const PropertySetup = dynamic(() => import("./dashboard/components/PropertySetup"), {
  ssr: false,
  loading: PageLoading,
});
const Integrations = dynamic(() => import("./dashboard/components/Integrations"), {
  ssr: false,
  loading: PageLoading,
});
const ActivityLog = dynamic(() => import("./dashboard/components/ActivityLog"), {
  ssr: false,
  loading: PageLoading,
});
const Workflow = dynamic(() => import("./dashboard/components/Workflow"), {
  ssr: false,
  loading: PageLoading,
});
const RateParity = dynamic(() => import("./dashboard/components/RateParity"), {
  ssr: false,
  loading: PageLoading,
});
const GoogleListingSetup = dynamic(() => import("./dashboard/components/GoogleListingSetup"), {
  ssr: false,
  loading: PageLoading,
});
const CheckinSettings = dynamic(() => import("./dashboard/components/CheckinSettings"), {
  ssr: false,
  loading: PageLoading,
});
const DisplaySettings = dynamic(() => import("./dashboard/components/DisplaySettings"), {
  ssr: false,
  loading: PageLoading,
});
const HotelBrand = dynamic(() => import("./dashboard/components/HotelBrand"), {
  ssr: false,
  loading: PageLoading,
});
const PropertyProfile = dynamic(() => import("./dashboard/components/PropertyProfile"), {
  ssr: false,
  loading: PageLoading,
});
const Events = dynamic(() => import("./dashboard/components/Events"), {
  ssr: false,
  loading: PageLoading,
});
const CompetitorShopper = dynamic(() => import("./dashboard/components/CompetitorShopper"), {
  ssr: false,
  loading: PageLoading,
});
const DynamicPricingGrid = dynamic(() => import("./dashboard/components/DynamicPricingGrid"), {
  ssr: false,
  loading: PageLoading,
});
const CityLedger = dynamic(() => import("./dashboard/components/CityLedger"), {
  ssr: false,
  loading: PageLoading,
});
const Companies = dynamic(() => import("./dashboard/components/Companies"), {
  ssr: false,
  loading: PageLoading,
});
const Guests = dynamic(() => import("./dashboard/components/Guests"), {
  ssr: false,
  loading: PageLoading,
});
const Reservations = dynamic(() => import("./dashboard/components/Reservations"), {
  ssr: false,
  loading: PageLoading,
});
const TapeChart = dynamic(() => import("./dashboard/components/TapeChart"), {
  ssr: false,
  loading: PageLoading,
});
const RoomInventory = dynamic(() => import("./dashboard/components/RoomInventory"), {
  ssr: false,
  loading: PageLoading,
});
const Housekeeping = dynamic(() => import("./dashboard/components/Housekeeping"), {
  ssr: false,
  loading: PageLoading,
});
const BillingSetup = dynamic(() => import("./dashboard/components/BillingSetup"), {
  ssr: false,
  loading: PageLoading,
});
const BookingPerformance = dynamic(() => import("./dashboard/components/BookingPerformance"), {
  ssr: false,
  loading: PageLoading,
});
const NightAudit = dynamic(() => import("./dashboard/components/NightAudit"), {
  ssr: false,
  loading: PageLoading,
});
const InvoicingReport = dynamic(() => import("./dashboard/components/InvoicingReport"), {
  ssr: false,
  loading: PageLoading,
});
const PaymentsReport = dynamic(() => import("./dashboard/components/PaymentsReport"), {
  ssr: false,
  loading: PageLoading,
});
const CashBook = dynamic(() => import("./dashboard/components/CashBook"), {
  ssr: false,
  loading: PageLoading,
});
const PoliceReport = dynamic(() => import("./dashboard/components/PoliceReport"), {
  ssr: false,
  loading: PageLoading,
});
const UserRights = dynamic(() => import("./dashboard/components/UserRights"), {
  ssr: false,
  loading: PageLoading,
});

// Where the header remembers the chosen property across a refresh.
const PROPERTY_KEY = "hms.propertyId";
// Where the area tabs remember the page last used in each area.
const LAST_PAGE_KEY = "hms.lastPageInArea";
// Where each user's chosen start page is kept, per browser.
const START_KEY = "hms.startPage";
// The date of the newest release note this browser has read.
const NOTES_SEEN_KEY = "hms.whatsNewSeen";
// Page ids that moved, so an old bookmark still lands on the right page.
const MOVED_PAGES = { pmssetup: "rooms", whatsnew: "explore" };

/** Which job someone's rights say they do: owner, desk, housekeeping or other. */
function jobProfile(canSee) {
  if (canSee("performance") || canSee("nightaudit")) return "owner";
  if (canSee("calendar") || canSee("reservations")) return "desk";
  if (canSee("housekeeping")) return "housekeeping";
  return "other";
}

/**
 * Where someone opens when they have not chosen: the owner and the desk on
 * Today, whose arrivals and departures carry Check in, Check out and Walk-in,
 * and housekeeping on Housekeeping.
 */
function defaultStartPage(canSee) {
  const profile = jobProfile(canSee);
  if (profile === "owner" || profile === "desk") return "today";
  if (profile === "housekeeping") return "housekeeping";
  return "";
}

export default function V2Dashboard() {
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // The open page lives in the URL hash, so a refresh reopens where you were
  // and a page can be linked to. This page is prerendered, so the hash is
  // read in an effect rather than here: the server has no hash, and starting
  // from one would not match what it rendered. Empty until then, which the
  // loading spinner already covers.
  const [active, setActive] = useState("");
  // The starting filter the open page was asked for, if any (see openPage).
  const [pageView, setPageView] = useState(null);
  // The page last opened in each area, so an area tab goes back to it.
  const [lastInArea, setLastInArea] = useState({});
  useEffect(() => {
    try {
      setLastInArea(JSON.parse(localStorage.getItem(LAST_PAGE_KEY) || "{}") || {});
    } catch {}
  }, []);
  // Bumped when room types are saved on the Rooms page; see that page.
  const [roomTypesVersion, setRoomTypesVersion] = useState(0);
  // The sidebar collapses to give the grid its full width, which matters most
  // on the Channel Manager's 30-day view.
  const [railOpen, setRailOpen] = useState(true);
  // On a phone there is no room for a rail beside the page, so the sidebar
  // becomes a drawer over it, opened from the header and closed by choosing
  // a page. Separate from `railOpen`, so collapsing the rail on a desktop is
  // not undone by visiting on a phone, nor the other way round.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The shortcut as this keyboard writes it. Read after mounting: the page is
  // prerendered, and the server cannot know what the visitor types on.
  const [shortcut, setShortcut] = useState("Ctrl K");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "")) setShortcut("⌘K");
  }, []);
  // The property every page works against. A super admin switches it here in
  // the header rather than inside each page, so there is one answer to "which
  // property am I changing" wherever they are.
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const json = res.ok ? await res.json() : null;
        // The session route returns { user: {...} }.
        if (!cancelled) setSession(json?.user ?? null);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // The properties this session may work in. A super admin gets the full list
  // and may switch; everyone else gets only their own, so the control shows
  // where they are without offering a change they may not make.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/properties")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.properties) return;
        setProperties(j.properties);
        // A refresh keeps the property the super admin last chose, rather
        // than falling back to the one their login was issued for. Ignored
        // if it is no longer in the list this session may see.
        let remembered = "";
        try {
          remembered = localStorage.getItem(PROPERTY_KEY) || "";
        } catch {}
        if (!j.properties.some((p) => p.id === remembered)) remembered = "";
        setPropertyId(
          (cur) => cur || remembered || session.propertyId || j.properties[0]?.id || ""
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session]);

  /**
   * The session as the pages should see it: the selected property, not the
   * one the cookie was issued for. Pages read propertyId from here, so a
   * switch in the header moves every page at once.
   */
  const scopedSession = useMemo(() => {
    if (!session) return null;
    const chosen = properties.find((p) => p.id === propertyId);
    const propertyTimezone = chosen?.timezone || session.propertyTimezone || null;
    const propertyCurrency = chosen?.currency || session.propertyCurrency || null;
    // Set here, before any page renders, so every "today" and every price on
    // every page is the hotel's own (lib/hotelTime.js, lib/money.js) from the
    // first paint.
    setHotelZone(propertyTimezone);
    setHotelDayStart(chosen?.day_change_time || session.propertyDayChange);
    setHotelCurrency(propertyCurrency);
    return {
      ...session,
      propertyId: propertyId || session.propertyId,
      propertyName: chosen?.name || session.propertyName,
      // New bookings default the guest's country to the hotel's own.
      propertyCountry: chosen?.country_code || chosen?.country || null,
      propertyTimezone,
      propertyCurrency,
      // Switching happens in the header now, so no page offers its own picker.
      canSwitchProperties: false,
    };
  }, [session, properties, propertyId]);

  const areas = useMemo(() => visibleAreas(session), [session]);

  // The top bar follows the open page rather than being selected separately,
  // so switching areas and landing on a page keep one source of truth.
  //
  // Nothing is selected until a page is. `areaForPage` falls back to the first
  // area for a page it does not know, which before a page is settled would
  // light up Front Office and its sidebar for as long as the session takes to
  // load, then jump to the real page -- a visible flash on every refresh.
  const currentArea = useMemo(
    () => (active ? areaForPage(areas, active) : null),
    [areas, active]
  );

  // Settle on a page: the hash if it names one this session may see,
  // otherwise this person's start page.
  //
  // Waits for the session, because `areas` without one is not yet the real
  // answer -- it omits Setup, so judging a #rateplans hash against it would
  // reject a page the user is in fact allowed, and nothing would revisit that
  // once a page had been chosen. After that it runs whenever `active` leaves
  // the visible set, which is what drops a hash naming a page this user may
  // not open, or one left over from a page that has since been renamed.
  useEffect(() => {
    if (sessionLoading || !areas.length) return;
    const canSee = (id) => areas.some((a) => a.pages.some((p) => p.id === id));
    if (canSee(active)) return;

    const raw = window.location.hash.slice(1);
    const hashed = MOVED_PAGES[raw] || raw;
    if (canSee(hashed)) {
      setActive(hashed);
      return;
    }
    // No page in the address: open where this person works. Their own
    // choice if they pinned one, else what their rights say they do.
    let pinned = "";
    try {
      pinned = localStorage.getItem(`${START_KEY}.${session?.id || ""}`) || "";
    } catch {}
    setActive(canSee(pinned) ? pinned : defaultStartPage(canSee) || areas[0].pages[0].id);
  }, [areas, active, sessionLoading, session?.id]);

  // Write the open page back to the hash. replaceState rather than assigning
  // to location.hash, so moving around the dashboard does not fill the back
  // button with every page visited; back leaves the dashboard as before.
  useEffect(() => {
    // Not while the session is still loading: `areas` is at its widest then,
    // and writing the page chosen against it would overwrite the incoming
    // hash before the effect above has had the loaded session to judge it by.
    if (sessionLoading || !active) return;
    if (window.location.hash.slice(1) === active) return;
    window.history.replaceState(null, "", `#${active}`);
  }, [active, sessionLoading]);

  // Count the page open -- page, role and job profile only, never who (see
  // /api/usage). Fire and forget: nothing waits on it.
  useEffect(() => {
    if (sessionLoading || !active || !session) return;
    const canSee = (id) => areas.some((a) => a.pages.some((p) => p.id === id));
    const profile = jobProfile(canSee);
    fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: active, profile, propertyId: propertyId || undefined }),
      keepalive: true,
    }).catch(() => {});
    // Once per page opened; a property switch is not a new open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionLoading]);

  // Back and forward still move between pages when the hash does change --
  // from a pasted link, or from the browser's own history.
  useEffect(() => {
    function onHashChange() {
      const id = window.location.hash.slice(1);
      if (id) setActive(MOVED_PAGES[id] || id);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Escape closes the drawer, as it would any other overlay.
  useEscape(() => setDrawerOpen(false), drawerOpen);

  // Widening past a phone -- a rotated tablet, a resized window -- brings the
  // rail back, so a drawer left open would sit on the rail as a wider copy.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = (e) => e.matches && setDrawerOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // Ctrl+K (⌘K on a Mac) opens the palette from anywhere, even from inside a
  // field -- it is the browser's own shortcut for its search bar otherwise,
  // which is no use inside the app.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Open a page. `view` is an optional starting filter the page understands
   * -- the home page's Arrivals tile opens Reservations on today's arrivals.
   * It is used once, by the page as it opens.
   */
  // The page this person opens on; see the landing effect above.
  const [startPage, setStartPage] = useState("");
  useEffect(() => {
    if (!session?.id) return;
    try {
      setStartPage(localStorage.getItem(`${START_KEY}.${session.id}`) || "");
    } catch {}
  }, [session?.id]);
  function toggleStartPage(id) {
    const next = startPage === id ? "" : id;
    setStartPage(next);
    try {
      if (next) localStorage.setItem(`${START_KEY}.${session.id}`, next);
      else localStorage.removeItem(`${START_KEY}.${session.id}`);
    } catch {}
  }

  function openPage(id, view = null) {
    // Back on the page a booking was left from, by any route: the way back
    // has been taken, so it is not offered again on some later page.
    setBack((b) => (b && b.page === id ? null : b));
    setPageView(view);
    setActive(id);
    setDrawerOpen(false);
    const area = areaForPage(areas, id);
    // The Home tab always returns to Today: Explore is a guide to look
    // something up in, not somewhere to work.
    if (area && id !== "explore") {
      setLastInArea((prev) => {
        const next = { ...prev, [area.id]: id };
        try {
          localStorage.setItem(LAST_PAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }

  /** An area tab returns to the page last used there, else its first page. */
  function openArea(area) {
    const last = lastInArea[area.id];
    openPage(area.pages.some((p) => p.id === last) ? last : area.pages[0].id);
  }

  const canOpen = (id) => canOpenPage(areas, id);

  // A booking left to set something up (a day-use plan, a service), and the
  // page it was open on, so the setup page can offer the way back to it.
  const [back, setBack] = useState(null);
  function leaveFor(id, booking) {
    closeBackBooking();
    openPage(id);
    setBack({ ...booking, page: active });
  }
  const pageNav = { openPage, leaveFor, canOpen };
  // The booking tour, for a new user who takes bookings. It opens by itself
  // only for the person who signed the hotel up, straight after sign-up;
  // staff added later are offered it on Today. Explore starts it any time.
  const canBook = canOpen("calendar") || canOpen("reservations");
  // The practice tour running: { tour, firstRun }, or null. `firstRun` is the
  // new user's own, with the room check first.
  const [practice, setPractice] = useState(null);
  const tourOpen = Boolean(practice);
  // Show me how, from the bar along the bottom (TourGuide.jsx).
  const [guideOpen, setGuideOpen] = useState(false);
  const [tourOffered, setTourOffered] = useState(false);
  // Finished, skipped or declined in this visit: the session still says due.
  const [tourDone, setTourDone] = useState(false);
  const tourDue = Boolean(session?.tourDue) && canBook && !tourDone;
  useEffect(() => {
    if (tourOffered || !tourDue || !session?.tourAuto || !propertyId) return;
    setTourOffered(true);
    setPractice({ firstRun: true });
  }, [tourOffered, tourDue, session, propertyId]);
  const endTour = useCallback((done) => {
    setPractice(null);
    if (done) setTourDone(true);
  }, []);
  const tourOffer =
    tourDue && !tourOpen
      ? {
          onStart: () => setPractice({ firstRun: true }),
          onDecline: () => {
            fetch("/api/auth/tour", { method: "POST" }).catch(() => {});
            setTourDone(true);
          },
        }
      : null;
  // A booking changed in the reopened window redraws the page behind it once,
  // when the window closes, so the page shows it without losing its place on
  // every payment. A channel that could not be told is said, as the
  // Calendar says it.
  const [pageStamp, setPageStamp] = useState(0);
  const [backChanged, setBackChanged] = useState(false);
  const [syncWarning, setSyncWarning] = useState(null);
  const {
    openBooking,
    newBooking,
    close: closeBackBooking,
    modal: backModal,
  } = useBookingOpener(
    scopedSession,
    (warning) => {
      setBackChanged(true);
      if (warning) setSyncWarning(warning);
    },
    () => {
      if (backChanged) setPageStamp((n) => n + 1);
      setBackChanged(false);
    }
  );
  function goBack() {
    const b = back;
    setBack(null);
    openPage(b.page);
    // Fresh services, so one just set up is on the list.
    if (b.reservationId) openBooking(b.reservationId, b.tab, { fresh: true, prefill: b.prefill, restore: b.restore });
    else newBooking(b.prefill, b.restore);
  }
  // Never offer the way back into another hotel's booking.
  useEffect(() => {
    setBack(null);
    closeBackBooking();
  }, [propertyId, closeBackBooking]);

  // Explore is marked New until its What's new tab is opened, counting only
  // releases with something for this reader, so a change to a page they
  // cannot open never calls them over. Null until the browser has answered, so it never flashes.
  const [notesSeen, setNotesSeen] = useState(null);
  useEffect(() => {
    try {
      setNotesSeen(localStorage.getItem(NOTES_SEEN_KEY) || "");
    } catch {}
  }, []);
  const latestNote =
    RELEASE_NOTES.find((r) => r.points.some((p) => !p.page || canOpen(p.page)))?.date || "";
  const hasNews = notesSeen !== null && latestNote > notesSeen;
  const markNewsSeen = useCallback(() => {
    if (!latestNote) return;
    setNotesSeen(latestNote);
    try {
      localStorage.setItem(NOTES_SEEN_KEY, latestNote);
    } catch {}
  }, [latestNote]);

  // The drawer lists every area's pages, so a phone reaches any page in two
  // taps rather than choosing an area first and then opening the drawer. The
  // rail beside the page stays with the open area, as the tabs above it do.
  const railAreas = drawerOpen ? areas : currentArea ? [currentArea] : [];
  const expanded = railOpen || drawerOpen;

  const pageLabel = currentArea?.pages.find((p) => p.id === active)?.label || "";

  return (
    <ToastProvider>
      <DialogProvider>
      <PageNavProvider value={pageNav}>
      <main className="min-h-screen pb-[34px]" style={{ background: "var(--page)" }}>
        {/* Row 1 — brand, property, account */}
        <header
          className="sticky top-0 z-30 flex h-[46px] items-center justify-between gap-2 px-3 md:px-4"
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex flex-shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded md:hidden"
              style={{ color: "var(--text)" }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 5h12M3 9h12M3 13h12" />
              </svg>
            </button>
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded text-[10px] font-bold"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              OH
            </span>
            <span className="hidden text-sm font-semibold sm:inline" style={{ color: "var(--text)" }}>
              HMS<span style={{ color: "var(--text-muted)", fontWeight: 400 }}> | Online Hotelier</span>
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-1">
            {/* The palette's visible door, so the shortcut can be found by
                looking rather than only by knowing it. */}
            {areas.length > 0 && (
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="mr-2 flex flex-shrink-0 items-center gap-2 rounded px-2 py-1 text-sm transition hover:opacity-80"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
                aria-label="Search pages and bookings"
                title={`Search pages and bookings (${shortcut})`}
              >
                <Icon name="search" size={16} />
                <span className="hidden lg:inline">Search</span>
                <span className="kbd hidden md:inline-block">{shortcut}</span>
              </button>
            )}
            {/* A super admin picks the property; everyone else sees theirs named.
                Either way this is the one place it is set. */}
            {session?.canSwitchProperties && properties.length > 1 ? (
              <Select
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  try {
                    localStorage.setItem(PROPERTY_KEY, e.target.value);
                  } catch {}
                }}
                aria-label="Property"
                className="mr-2 min-w-0 max-w-[38vw] truncate rounded px-2 py-1 text-sm md:max-w-none md:flex-shrink-0"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : (
              scopedSession?.propertyName && (
                <span className="mr-2 min-w-0 truncate text-sm" style={{ color: "var(--text-muted)" }}>
                  {scopedSession.propertyName}
                </span>
              )
            )}
            <Link
              href="/admin"
              className="flex-shrink-0 rounded px-2 py-1 text-xs transition hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              Admin
            </Link>
            <ThemeToggle />
            <AccountMenu email={session?.email} />
          </div>
        </header>

        {/* Row 2 — areas */}
        <nav
          className="no-scrollbar sticky top-[46px] z-20 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-2 md:px-4"
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {areas.map((area) => {
            const on = currentArea?.id === area.id;
            return (
              <button
                key={area.id}
                type="button"
                // Entering an area returns to the page last used there (its
                // first page the first time), so a tab click always lands
                // somewhere useful rather than on the same first page.
                onClick={() => openArea(area)}
                className="relative flex-shrink-0 px-3 py-2.5 text-[13px] transition"
                style={{
                  color: on ? "var(--accent-text)" : "var(--text-muted)",
                  fontWeight: on ? 600 : 500,
                }}
              >
                {area.label}
                {area.id === "home" && hasNews && (
                  <span
                    className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-top"
                    style={{ background: "var(--accent)" }}
                    aria-label="Something new"
                  />
                )}
                {on && (
                  <span
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-t"
                    style={{ background: "var(--accent)" }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex">
          {/* Backdrop behind the drawer on a phone; a tap outside closes it. */}
          {drawerOpen && (
            <div
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: "rgba(0, 0, 0, 0.4)" }}
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
          )}

          {/* Sidebar — the pages of the open area. A rail beside the page from
              tablet width up; below that, a drawer that slides in over it. */}
          <aside
            className={`fixed inset-y-0 left-0 z-50 flex-shrink-0 overflow-y-auto transition-all md:sticky md:top-[84px] md:z-auto md:h-[calc(100vh-118px)] md:translate-x-0 ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            style={{
              width: expanded ? (drawerOpen ? 256 : 208) : 44,
              background: "var(--surface)",
              borderRight: "1px solid var(--border)",
            }}
            aria-label="Pages"
          >
            <div className="flex items-center justify-between px-2 py-2">
              {/* The drawer's own close button, where the rail has its collapse. */}
              <span className="px-2 text-sm font-semibold md:hidden" style={{ color: "var(--text)" }}>
                Menu
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded text-lg md:hidden"
                style={{ color: "var(--text-muted)" }}
              >
                <Icon name="close" size={18} />
              </button>
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                aria-label={railOpen ? "Collapse menu" : "Expand menu"}
                title={railOpen ? "Collapse menu" : "Expand menu"}
                className="ml-auto hidden rounded px-1.5 py-1 text-xs transition hover:opacity-70 md:block"
                style={{ color: "var(--text-faint)" }}
              >
                {railOpen ? "«" : "»"}
              </button>
            </div>

            <nav className="flex flex-col gap-0.5 px-2 pb-4">
              {railAreas.map((area, i) => (
                <div key={area.id} className={`flex flex-col gap-0.5 ${i > 0 ? "mt-3" : ""}`}>
                  {expanded && (
                    <p
                      className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {area.label}
                    </p>
                  )}

                  {area.pages.map((page) => {
                    const on = active === page.id;
                    const soon = PLACEHOLDER_PAGES.has(page.id);
                    const isNew = page.id === "explore" && hasNews;
                    const isStart = (startPage || defaultStartPage(canOpen)) === page.id;
                    return (
                      <div key={page.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => openPage(page.id)}
                        title={expanded ? undefined : page.label}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded px-2 text-left text-[13px] transition ${
                          drawerOpen ? "py-2.5" : "py-[7px]"
                        }`}
                        style={{
                          background: on ? "var(--accent-soft)" : "transparent",
                          color: on ? "var(--accent-text)" : "var(--text-muted)",
                          fontWeight: on ? 600 : 500,
                        }}
                      >
                        <span className="flex-shrink-0">
                          <Icon name={page.icon} />
                        </span>
                        {expanded && (
                          <>
                            <span className="flex-1 truncate">{page.label}</span>
                            {soon && (
                              <span
                                className="rounded px-1 py-[1px] text-[8.5px] font-semibold uppercase tracking-wide"
                                style={{
                                  background: "var(--surface-2)",
                                  color: "var(--text-faint)",
                                }}
                              >
                                Soon
                              </span>
                            )}
                            {isNew && (
                              <span
                                className="rounded px-1 py-[1px] text-[8.5px] font-semibold uppercase tracking-wide"
                                style={{ background: "var(--accent)", color: "#fff" }}
                              >
                                New
                              </span>
                            )}
                          </>
                        )}
                      </button>
                      {/* The start page shows a house; the open page offers to
                          become it. */}
                      {expanded && (on || isStart) && (
                        <button
                          type="button"
                          onClick={() => toggleStartPage(page.id)}
                          className="ml-1 flex-shrink-0 rounded p-1"
                          style={{ color: isStart ? "var(--accent)" : "var(--text-faint)" }}
                          title={isStart ? "Your start page" : "Open on this page each time"}
                          aria-label={isStart ? `${page.label} is your start page` : `Make ${page.label} your start page`}
                          aria-pressed={isStart}
                        >
                          <Icon name="home" size={14} strokeWidth={isStart ? 2.2 : 1.6} />
                        </button>
                      )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <section className="min-w-0 flex-1">
            <div className="mx-auto max-w-[1400px] p-3 sm:p-4 md:p-6">
              {sessionLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="space-y-3 text-center">
                    <div
                      className="inline-block h-7 w-7 animate-spin rounded-full border-2"
                      style={{
                        borderColor: "var(--border)",
                        borderTopColor: "var(--accent)",
                      }}
                    />
                    <p className="sub">Loading dashboard...</p>
                  </div>
                </div>
              ) : !areas.length ? (
                <div className="card card-pad sub">
                  No pages have been given to your account yet. Ask your property admin for access.
                </div>
              ) : (
                /* Keyed by property, so switching hotels starts the open page
                   afresh: it shows its loading state instead of the last
                   hotel's figures until the new ones arrive, and an unsaved
                   edit can never carry over to the other hotel. */
                <Fragment key={scopedSession?.propertyId || ""}>
                  {/* Said once, when the menu was regrouped, so nobody hunts
                      for a page that moved. */}
                  <Hint id="menu-regrouped-2026-10" className="mb-4">
                      The menu now has four groups: Front desk, Rates, Reports and Setup. Night Audit
                      is under Front desk, everything about price is under Rates, and Integrations and
                      Activity Log are under Setup. The search at the top finds any page.
                  </Hint>
                  {back && (
                    <BackToBooking back={back} onBack={goBack} onForget={() => setBack(null)} onRestore={setBack} />
                  )}
                  {syncWarning && (
                    <div
                      className="card card-pad mb-3 flex items-start gap-3 text-sm"
                      style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", color: "var(--warn)" }}
                    >
                      <span className="flex-1">{syncWarning}</span>
                      <button type="button" className="btn btn-ghost text-xs" onClick={() => setSyncWarning(null)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                  {/* A crash stays inside the open page; opening another clears it. */}
                  <PageErrorBoundary key={`${active}-${pageStamp}`}>
                  {active === "today" && (
                    <TodayPage session={scopedSession} onOpenPage={openPage} canOpen={canOpen} tourOffer={tourOffer} />
                  )}

                  {/* Keyed by property so a switch starts the grid afresh:
                      an unsaved edit must never publish to another hotel. */}
                  {active === "explore" && (
                    <Explore
                      areas={areas}
                      hasNews={hasNews}
                      onNewsSeen={markNewsSeen}
                      onOpenPage={openPage}
                      canOpen={canOpen}
                      pageLabel={(id) => areas.flatMap((a) => a.pages).find((p) => p.id === id)?.label || id}
                    />
                  )}

                  {active === "cm" && (
                    <>
                      {!back && <SetupBanner session={scopedSession} skip={["roomTypes"]} />}
                      <ChannelManager key={scopedSession?.propertyId || ""} session={scopedSession} />
                    </>
                  )}

                  {active === "integrations" && <Integrations session={scopedSession} />}

                  {active === "logs" && <ActivityLog session={scopedSession} />}

                  {active === "parity" && <RateParity session={scopedSession} />}

                  {active === "pricing" && <DynamicPricingGrid session={scopedSession} />}

                  {active === "events" && <Events session={scopedSession} />}

                  {active === "performance" && <BookingPerformance session={scopedSession} />}

                  {active === "nightaudit" && <NightAudit session={scopedSession} />}

                  {active === "cashbook" && <CashBook session={scopedSession} />}

                  {active === "policereport" && <PoliceReport session={scopedSession} initialView={pageView} />}

                  {active === "invoicing" && <InvoicingReport session={scopedSession} />}

                  {active === "payments" && <PaymentsReport session={scopedSession} />}

                  {active === "cityledger" && <CityLedger session={scopedSession} />}

                  {/* Rooms and rate plans are separate pages; the component
                      renders one panel or the other. */}
                  {/* Room types, then the numbered rooms of each. Saving a
                      type remounts the room list so its type choices follow. */}
                  {active === "rooms" && (
                    <div className="space-y-4">
                      <PropertySetup
                        session={scopedSession}
                        only="rooms"
                        onSaved={() => setRoomTypesVersion((v) => v + 1)}
                      />
                      <RoomInventory key={roomTypesVersion} session={scopedSession} section />
                    </div>
                  )}

                  {active === "servicesetup" && (
                    <BillingSetup session={scopedSession} only="services" />
                  )}

                  {active === "taxsetup" && <BillingSetup session={scopedSession} only="taxes" />}

                  {active === "rateplans" && (
                    <PropertySetup session={scopedSession} only="plans" />
                  )}

                  {active === "setup" && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="h1">Property Setup</h2>
                        <p className="sub">
                          Your hotel&apos;s name and logo, its profile, its Google listing, how its screens look and online check-in.
                        </p>
                      </div>
                      <HotelBrand
                        propertyId={scopedSession?.propertyId}
                        onSaved={({ name }) =>
                          setProperties((list) =>
                            list.map((p) => (p.id === scopedSession?.propertyId ? { ...p, name } : p))
                          )
                        }
                      />
                      <PropertyProfile
                        propertyId={scopedSession?.propertyId}
                        onSaved={({ timezone, currency, country_code, day_change_time }) =>
                          setProperties((list) =>
                            list.map((p) =>
                              p.id === scopedSession?.propertyId
                                ? { ...p, timezone, currency, country_code, day_change_time: day_change_time || p.day_change_time }
                                : p
                            )
                          )
                        }
                      />
                      <GoogleListingSetup propertyId={scopedSession?.propertyId} />
                      <DisplaySettings propertyId={scopedSession?.propertyId} />
                      <CheckinSettings propertyId={scopedSession?.propertyId} />
                    </div>
                  )}

                  {active === "users" && session?.canManageUsers && (
                    <UserRights session={scopedSession} propertyId={scopedSession?.propertyId} />
                  )}

                  {active === "calendar" && (
                    <>
                      {!back && <SetupBanner session={scopedSession} skip={["roomTypes", "rooms"]} />}
                      <TapeChart session={scopedSession} />
                    </>
                  )}

                  {active === "reservations" && <Reservations session={scopedSession} initialView={pageView} />}

                  {active === "guests" && <Guests session={scopedSession} />}

                  {active === "companies" && <Companies session={scopedSession} />}

                  {active === "housekeeping" && <Housekeeping session={scopedSession} />}

                  {active === "workflow" && <Workflow session={scopedSession} />}

                  {active === "compshopper" && <CompetitorShopper session={scopedSession} />}
                  </PageErrorBoundary>

                </Fragment>
              )}
            </div>
          </section>
        </div>

        {areas.length > 0 && (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            areas={areas}
            session={scopedSession}
            onOpenPage={openPage}
            page={active}
          />
        )}

        {backModal}

        {practice && scopedSession && (
          <BookingTour
            session={scopedSession}
            pageNav={pageNav}
            onEnd={endTour}
            firstRun={Boolean(practice.firstRun)}
            {...(practice.tour ? { tour: practice.tour } : {})}
          />
        )}

        {areas.length > 0 && (
          <TourGuide
            open={guideOpen}
            onClose={() => setGuideOpen(false)}
            canOpen={canOpen}
            openPage={openPage}
            onStartPractice={(tour) => setPractice({ tour })}
          />
        )}

        <SupportBar
          propertyName={scopedSession?.propertyName}
          email={session?.email}
          onShowMe={areas.length > 0 ? () => setGuideOpen((o) => !o) : null}
        />
      </main>
      </PageNavProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
