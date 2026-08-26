import { readFile } from "node:fs/promises";

import { ENGINE_KEYS, type ConditionId, type EngineKey } from "@/lib/engines";
import { listSamples, resolveSamplePath } from "@/lib/samples";
import { runEngine, TnsaError } from "@/lib/tnsa";
import { score } from "@/lib/wer";

export const runtime = "nodejs";
export const maxDuration = 800;

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
  };

  const conditions: ConditionId[] = body.conditions?.length
    ? body.conditions
    : ["clean", "tel8k", "tel8k_noisy"];
  const languages = body.languages?.length ? new Set(body.languages) : null;
  const limit = Math.max(1, Math.min(body.limit ?? 10, 99));
  const withEmbeddings = body.embeddings !== false;

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

      send({ type: "start", total: chosen.length * conditions.length * ENGINE_KEYS.length });

      for (const sample of chosen) {
        let cleanVector: number[] | null = null;

        for (const condition of conditions) {
          if (!sample.conditions.includes(condition)) continue;
          const resolved = await resolveSamplePath(sample.id, condition);
          if (!resolved) continue;

          let audio: Blob;
          try {
            const bytes = await readFile(resolved.file);
            audio = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
          } catch {
            continue;
          }

          // The embedding model is shared across STT engines, so only one run
          // per condition needs to carry it back.
          const settled = await Promise.allSettled(
            ENGINE_KEYS.map((engine, index) =>
              runEngine(audio, resolved.name, {
                engine,
                language: sample.language ?? "auto",
                includeEmbedding: withEmbeddings && index === 0,
              })
            )
          );

          settled.forEach((outcome, index) => {
            const engine = ENGINE_KEYS[index];
            if (outcome.status === "rejected") {
              const reason = outcome.reason;
              send({
                type: "error",
                sample: sample.id,
                condition,
                engine,
                message: reason instanceof TnsaError ? reason.message : String(reason),
              });
              return;
            }

            const payload = outcome.value;
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
      }

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
