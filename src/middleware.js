import { NextResponse } from "next/server";
import { authDisabled, decodeSession } from "@/lib/session";
import { isAppHost } from "@/lib/appHost";

const PUBLIC_PATHS = new Set([
  "/login",
  // A new hotel arrives here from an onboarding link, before it has an account.
  "/onboard",
  // Someone who has lost their password has no session. The link is the key.
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/logout",
  // Vercel's daily cron has no session; the route checks CRON_SECRET itself.
  "/api/workflow/cron",
  "/api/whatsapp/daily-report",
  // A guest's online check-in. The link in the request is the key, checked
  // by the routes themselves.
  "/api/checkin",
  "/api/checkin/files",
]);

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // A hotel's own domain shows only its website. Every path is mounted under
  // /site/<domain>, so nothing of the app itself can be reached from it.
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (!isAppHost(host) && !pathname.startsWith("/_next")) {
    const url = request.nextUrl.clone();
    url.pathname = `/site/${host.replace(/^www\./, "")}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  if (authDisabled()) {
    return NextResponse.next();
  }

  // Allow Next.js internals, and the ID reader's files (code only, no guest data):
  // the guest's own check-in page loads them too.
  if (pathname.startsWith("/_next") || pathname.startsWith("/static") || pathname.startsWith("/ocr/")) {
    return NextResponse.next();
  }

  if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const sessionCookie = request.cookies.get("rate_session")?.value;
    const session = await decodeSession(sessionCookie);
    // Inbound webhooks are called server-to-server by a partner with no
    // session. The secret in the path authenticates them.
    const isPublic =
      PUBLIC_PATHS.has(pathname) ||
      pathname.startsWith("/checkin/") ||
      // The hotel's booking page and its routes. The page key, or the
      // guest's private booking link, is checked by the routes themselves.
      pathname.startsWith("/book/") ||
      // The hotel's website, which anyone may read.
      pathname.startsWith("/site/") ||
      pathname.startsWith("/api/book/") ||
      pathname === "/api/book" ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/webhooks/");

    if (!session && !isPublic) {
      // An API call cannot follow a redirect to a login page. fetch() chases
      // it, lands on HTML, and the caller sees an opaque network failure --
      // "Load failed" in Safari -- with nothing in the server logs, because
      // as far as the server is concerned it answered fine. The desk fills in
      // a booking, clicks save, and is told nothing it can act on.
      //
      // So an expired session is reported to code as a 401 it can read, and
      // only a page navigation is sent to the login screen.
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Your session has expired. Sign in again to continue." },
          { status: 401 }
        );
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (session && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/(.*)"],
};
