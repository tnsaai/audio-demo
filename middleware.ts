import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, readSession } from "@/lib/auth";

/**
 * Gate everything behind the session cookie.
 *
 * Pages redirect to /login carrying where they were headed; API routes get a
 * 401 instead, because a fetch that silently follows a redirect to an HTML
 * login page produces a confusing JSON parse error at the call site.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isAuthRoute = pathname.startsWith("/api/auth/");
  const isLoginPage = pathname === "/login";
  if (isAuthRoute || isLoginPage) return NextResponse.next();

  const username = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (username) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "not signed in", code: "unauthenticated" },
      { status: 401 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
