import { NextResponse } from "next/server";

import type { ConditionId } from "@/lib/engines";
import { loadSampleAudio, playbackRedirect } from "@/lib/samples";

export const runtime = "nodejs";

/**
 * Serves a sample clip to the `<audio>` element.
 *
 * Dataset clips redirect to the Hugging Face CDN so audio never streams through
 * a serverless function; local and drop-in files are read and proxied.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const condition = (url.searchParams.get("condition") ?? "clean") as ConditionId;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const redirect = playbackRedirect(id, condition);
  if (redirect) return NextResponse.redirect(redirect, 302);

  const audio = await loadSampleAudio(id, condition);
  if (!audio) return NextResponse.json({ error: "unknown sample" }, { status: 404 });

  return new NextResponse(audio.bytes, {
    headers: {
      "Content-Type": audio.contentType,
      "Content-Length": String(audio.bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
