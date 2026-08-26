import { NextResponse } from "next/server";

import { arenConfigured, customDir, listSamples } from "@/lib/samples";

export const runtime = "nodejs";

export async function GET() {
  const samples = await listSamples();
  return NextResponse.json({
    samples,
    count: samples.length,
    arenConfigured: arenConfigured(),
    customDir: customDir() || null,
  });
}
