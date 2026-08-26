import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { ENGINE_KEYS, isEngineKey, type ConditionId, type EngineKey } from "@/lib/engines";
import { resolveSamplePath, listSamples } from "@/lib/samples";
import { runEngine, TnsaError, type OutputsResponse } from "@/lib/tnsa";

export const runtime = "nodejs";
export const maxDuration = 300;

export type EngineRun =
  | { engine: EngineKey; ok: true; result: OutputsResponse }
  | { engine: EngineKey; ok: false; code: string; message: string };

export type CompareResponse = {
  filename: string;
  condition: ConditionId;
  language: string;
  reference: string | null;
  referenceLanguage: string | null;
  runs: EngineRun[];
};

/**
 * Run both engines over the same audio concurrently.
 *
 * Concurrency is the point: the presenter is comparing output quality, and
 * running them in series would double the wait for no benefit. One engine
 * failing must not take the other down with it, so each is settled separately
 * and reported on its own.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const language = String(form.get("language") ?? "auto");
  const targetLanguage = String(form.get("target_language") ?? "") || undefined;
  const condition = (String(form.get("condition") ?? "clean") || "clean") as ConditionId;
  const requested = String(form.get("engines") ?? "").split(",").filter(isEngineKey);
  const engines: EngineKey[] = requested.length ? requested : ENGINE_KEYS;

  let audio: Blob;
  let filename: string;
  let reference: string | null = null;
  let referenceLanguage: string | null = null;

  const sampleId = form.get("sample_id");
  if (typeof sampleId === "string" && sampleId) {
    const resolved = await resolveSamplePath(sampleId, condition);
    if (!resolved) {
      return NextResponse.json({ error: `unknown sample '${sampleId}'` }, { status: 404 });
    }
    try {
      const bytes = await readFile(resolved.file);
      audio = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
    } catch {
      return NextResponse.json(
        { error: `sample file missing on disk: ${resolved.file}` },
        { status: 404 }
      );
    }
    filename = resolved.name;
    const sample = (await listSamples()).find((item) => item.id === sampleId);
    reference = sample?.reference ?? null;
    referenceLanguage = sample?.language ?? null;
  } else {
    const upload = form.get("audio");
    if (!(upload instanceof Blob) || upload.size === 0) {
      return NextResponse.json({ error: "no audio supplied" }, { status: 400 });
    }
    audio = upload;
    filename = (upload as File).name || "recording.wav";
    const supplied = form.get("reference");
    if (typeof supplied === "string" && supplied.trim()) reference = supplied.trim();
  }

  const settled = await Promise.allSettled(
    engines.map((engine) =>
      runEngine(audio, filename, { engine, language, targetLanguage })
    )
  );

  const runs: EngineRun[] = settled.map((outcome, index) => {
    const engine = engines[index];
    if (outcome.status === "fulfilled") return { engine, ok: true, result: outcome.value };
    const reason = outcome.reason;
    if (reason instanceof TnsaError) {
      return { engine, ok: false, code: reason.code, message: reason.message };
    }
    return { engine, ok: false, code: "unexpected", message: String(reason) };
  });

  const body: CompareResponse = {
    filename,
    condition,
    language,
    reference,
    referenceLanguage,
    runs,
  };
  return NextResponse.json(body);
}
