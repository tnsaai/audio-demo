import { ENGINE_KEYS, type BenchmarkId, type ConditionId, type EngineKey } from "@/lib/engines";
import { fetchDiarAudio, listDiarRows } from "@/lib/diarbench";
import { listSamples, loadSampleAudio } from "@/lib/samples";
import { runEngines, TnsaError } from "@/lib/tnsa";
import { score } from "@/lib/wer";

export const runtime = "nodejs";
// Vercel caps this by plan: 60 s on Hobby, up to 300 s on Pro. A full 99-clip
// pass exceeds both — run large sweeps locally, or lower the clip count.
export const maxDuration = 300;

export type BenchmarkEvent =
  | { type: "start"; total: number }
  | {
      type: "row";
      sample: string;
      language: string;
      source: string;
      condition: ConditionId;
      engine: EngineKey;
      wer: number;
      insertions: number;
      deletions: number;
      substitutions: number;
      referenceWords: number;
      hallucinated: boolean;
      empty: boolean;
      latencyMs: number;
      text: string;
      /** Correction-stage telemetry, so a silent no-op is distinguishable. */
      correctionMs?: number;
      correctedSegments?: number;
      correctionError?: string;
    }
  | {
      /** Embedding robustness: same utterance, clean vs a degraded condition. */
      type: "embedding";
      sample: string;
      language: string;
      condition: ConditionId;
      cosineVsClean: number;
      embeddingMs: number;
    }
  | { type: "error"; sample: string; condition: ConditionId; engine: EngineKey; message: string }
  | { type: "done"; elapsedMs: number };

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denominator = Math.sqrt(na) * Math.sqrt(nb);
  return denominator ? dot / denominator : 0;
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Clips were processed strictly one at a time, which left the GPU idle for the
 * whole of every upload, download and correction round trip. The limit stays
 * modest on purpose: the box is shared, and past a handful of concurrent long
 * requests the gateway returns 504s rather than going faster.
 */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Streams a benchmark run as NDJSON.
 *
 * Samples are the outer loop and conditions the inner one, so each clip's
 * clean vector is still in hand when its degraded variants come through and
 * the cross-condition embedding similarity can be emitted immediately rather
 * than buffering every vector for the whole run.
 *
 * A full ARen pass is 99 clips x 3 conditions x 2 engines = 594 transcriptions
 * and takes many minutes, so results stream as they land and the page can be
 * stopped early.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    conditions?: ConditionId[];
    languages?: string[];
    limit?: number;
    embeddings?: boolean;
    benchmark?: BenchmarkId;
    /** DiarBench config name, e.g. "Telugu". */
    diarLanguage?: string;
    /** Clips in flight at once. */
    concurrency?: number;
    /** Skip the AGen pass - much faster, and isolates the acoustic models. */
    skipCorrection?: boolean;
    /** Restrict the run to a subset of engines. */
    engines?: EngineKey[];
  };

  // Each clip issues one request per acoustic model, so N here means 2N in
  // flight. Measured: 8 concurrent /outputs reliably took the shared box down
  // (health 200 immediately before, 502 immediately after, reproduced twice).
  // 2 clips -> 4 concurrent is the largest setting that stayed stable.
  const concurrency = Math.max(1, Math.min(body.concurrency ?? 2, 4));
  const engines: EngineKey[] = body.engines?.length
    ? body.engines.filter((key) => ENGINE_KEYS.includes(key))
    : ENGINE_KEYS;
  const skipCorrection = body.skipCorrection === true;

  const conditions: ConditionId[] = body.conditions?.length
    ? body.conditions
    : ["clean", "tel8k", "tel8k_noisy"];
  const languages = body.languages?.length ? new Set(body.languages) : null;
  const limit = Math.max(1, Math.min(body.limit ?? 10, 99));
  const withEmbeddings = body.embeddings !== false;

  if ((body.benchmark ?? "aren") === "diarbench") {
    return runDiarBench(
      body.diarLanguage ?? "Telugu",
      Math.max(1, Math.min(body.limit ?? 2, 100)),
      // DiarBench clips are ~200 s; keep fewer in flight than for ARen.
      Math.max(1, Math.min(concurrency, 3)),
      skipCorrection,
      engines
    );
  }

  const all = await listSamples();
  const chosen = all
    .filter((sample) => sample.origin === "aren" && sample.reference)
    .filter((sample) => !languages || (sample.language && languages.has(sample.language)))
    .slice(0, limit);

  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BenchmarkEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      send({ type: "start", total: chosen.length * conditions.length * engines.length });

      // One task per sample, conditions sequential inside it: the clean vector
      // must be in hand before its degraded variants arrive for the
      // cross-condition embedding comparison.
      await pool(chosen, concurrency, async (sample) => {
        let cleanVector: number[] | null = null;

        for (const condition of conditions) {
          if (!sample.conditions.includes(condition)) continue;
          const loaded = await loadSampleAudio(sample.id, condition);
          if (!loaded) continue;
          const audio = new Blob([loaded.bytes], { type: loaded.contentType });

          // The embedding model is shared across STT engines, so only one run
          // per condition needs to carry it back.
          const results = await runEngines(audio, loaded.name, engines, {
            language: sample.language ?? "auto",
            includeEmbedding: withEmbeddings,
            skipCorrection,
          });

          ENGINE_KEYS.forEach((engine) => {
            const outcome = results.get(engine);
            if (!outcome || !outcome.ok) {
              const reason = outcome?.ok === false ? outcome.error : "no result";
              send({
                type: "error",
                sample: sample.id,
                condition,
                engine,
                message: reason instanceof TnsaError ? reason.message : String(reason),
              });
              return;
            }

            const payload = outcome.result;
            const text = payload.transcript?.text ?? "";
            const scored = score(sample.reference!, text, sample.language ?? undefined);
            send({
              type: "row",
              sample: sample.id,
              language: sample.language ?? "unknown",
              source: sample.source,
              condition,
              engine,
              wer: scored.wer,
              insertions: scored.insertions,
              deletions: scored.deletions,
              substitutions: scored.substitutions,
              referenceWords: scored.referenceWords,
              hallucinated: scored.hallucinated,
              empty: scored.empty,
              latencyMs: payload.latency.total_ms,
              text,
              correctionMs: payload.latency.correction_ms,
              correctedSegments: payload.transcript?.corrected_segment_count,
              correctionError: payload.correctionError,
            });

            const vector = payload.embedding?.vector;
            if (!withEmbeddings || !vector?.length) return;
            if (condition === "clean") {
              cleanVector = vector;
            } else if (cleanVector) {
              send({
                type: "embedding",
                sample: sample.id,
                language: sample.language ?? "unknown",
                condition,
                cosineVsClean: cosine(cleanVector, vector),
                embeddingMs: payload.latency.embedding_ms ?? 0,
              });
            }
          });
        }
      });

      send({ type: "done", elapsedMs: Date.now() - started });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Indic DiarBench pass.
 *
 * No acoustic conditions here — the set ships one recording per row — so the
 * loop is flat. Clips are long (~200 s), so each one is a substantial unit of
 * work and results stream as they land.
 */
async function runDiarBench(
  language: string,
  limit: number,
  concurrency: number,
  skipCorrection: boolean,
  engines: EngineKey[]
): Promise<Response> {
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BenchmarkEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}
`));

      const { rows } = await listDiarRows(language, limit);
      send({ type: "start", total: rows.length * engines.length });

      await pool(rows, concurrency, async (row) => {
        const bytes = await fetchDiarAudio(row.audioUrl);
        if (!bytes) {
          for (const engine of engines) {
            send({
              type: "error",
              sample: row.recordingId,
              condition: "clean",
              engine,
              message: "audio fetch failed (the signed URL may have expired)",
            });
          }
          return;
        }
        const audio = new Blob([bytes], { type: "audio/wav" });

        // V2 cannot be forced to most Indic codes; runEngine downgrades it to
        // auto. The correction engines still target the real language.
        const results = await runEngines(audio, `${row.recordingId}.wav`, engines, {
          language: row.languageCode,
          targetLanguage: row.languageCode,
          includeEmbedding: false,
          skipCorrection,
        });

        engines.forEach((engine) => {
          const outcome = results.get(engine);
          if (!outcome || !outcome.ok) {
            const reason = outcome?.ok === false ? outcome.error : "no result";
            send({
              type: "error",
              sample: row.recordingId,
              condition: "clean",
              engine,
              message: reason instanceof TnsaError ? reason.message : String(reason),
            });
            return;
          }
          const payload = outcome.result;
          const text = payload.transcript?.text ?? "";
          const scored = score(row.reference, text, row.languageCode);
          send({
            type: "row",
            sample: row.recordingId,
            language: row.languageCode,
            source: row.datasetType,
            condition: "clean",
            engine,
            wer: scored.wer,
            insertions: scored.insertions,
            deletions: scored.deletions,
            substitutions: scored.substitutions,
            referenceWords: scored.referenceWords,
            hallucinated: scored.hallucinated,
            empty: scored.empty,
            latencyMs: payload.latency.total_ms,
            text,
            correctionMs: payload.latency.correction_ms,
            correctedSegments: payload.transcript?.corrected_segment_count,
            correctionError: payload.correctionError,
          });
        });
      });

      send({ type: "done", elapsedMs: Date.now() - started });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
