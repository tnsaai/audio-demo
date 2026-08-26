import { NextResponse } from "next/server";

import { SESSION_COOKIE, authConfigured, checkCredentials, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      {
        error:
          "Auth is not configured. Set DEMO_USER, DEMO_PASSWORD and SESSION_SECRET in .env.local.",
        code: "auth_not_configured",
      },
      { status: 503 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  if (!checkCredentials(username, password)) {
    // One message for both wrong-user and wrong-password: naming which half was
    // wrong tells an attacker whether the account exists.
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  const token = await createSession(username);
  const response = NextResponse.json({ user: { username } });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure would break the http://localhost demo; enable it behind TLS.
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
