import { NextResponse } from "next/server";
import { decodeSession } from "@/lib/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
]);

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (process.env.DISABLE_AUTH === "true") {
    return NextResponse.next();
  }

  // Allow Next.js internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/static")) {
    return NextResponse.next();
  }

  if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const sessionCookie = request.cookies.get("rate_session")?.value;
    const session = await decodeSession(sessionCookie);
    // Inbound webhooks are called server-to-server by a partner with no
    // session. The secret in the path authenticates them.
    const isPublic =
      PUBLIC_PATHS.has(pathname) ||
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
