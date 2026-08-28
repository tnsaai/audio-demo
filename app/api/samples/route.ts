import { NextResponse } from "next/server";

import { customDir, datasetSource, listSamples } from "@/lib/samples";

export const runtime = "nodejs";

export async function GET() {
  const samples = await listSamples();
  return NextResponse.json({
    samples,
    count: samples.length,
    source: datasetSource(),
    customDir: customDir() || null,
  });
}
