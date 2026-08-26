import { NextResponse } from "next/server";

import { apiBase, hasKey, health } from "@/lib/tnsa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasKey()) {
    return NextResponse.json(
      { ok: false, base: apiBase, error: "TNSA_API_KEY is not set in .env.local" },
      { status: 503 }
    );
  }
  try {
    const payload = await health();
    return NextResponse.json({ ok: true, base: apiBase, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, base: apiBase, error: (error as Error).message },
      { status: 502 }
    );
  }
}
