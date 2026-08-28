import { NextResponse } from "next/server";

import { customDir, datasetSource, listIndicSamples, listSamples } from "@/lib/samples";
import { DIARBENCH_LANGUAGES } from "@/lib/engines";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const indic = new URL(request.url).searchParams.get("indic");
  // Indic configs are listed on request; see listIndicSamples for why.
  const samples = indic
    ? await listIndicSamples(indic)
    : await listSamples();
  return NextResponse.json({
    samples,
    count: samples.length,
    source: datasetSource(),
    customDir: customDir() || null,
    indicLanguages: DIARBENCH_LANGUAGES,
  });
}
