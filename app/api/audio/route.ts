import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import type { ConditionId } from "@/lib/engines";
import { resolveSamplePath } from "@/lib/samples";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};

/** Streams a sample clip to the `<audio>` element so the presenter can hear it. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const condition = (url.searchParams.get("condition") ?? "clean") as ConditionId;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const resolved = await resolveSamplePath(id, condition);
  if (!resolved) return NextResponse.json({ error: "unknown sample" }, { status: 404 });

  try {
    const bytes = await readFile(resolved.file);
    const extension = resolved.name.slice(resolved.name.lastIndexOf(".")).toLowerCase();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": MIME[extension] ?? "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }
}
