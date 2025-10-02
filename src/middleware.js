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
    const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith("/api/auth/");

    if (!session && !isPublic) {
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
