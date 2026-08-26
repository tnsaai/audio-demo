import "server-only";

import { ENGINES, type EngineKey } from "./engines";

/**
 * Server-side client for the TNSA Audio API on the GH200 box.
 *
 * The API key lives only in this module's process. Nothing here is ever
 * imported into a client component — `server-only` enforces that at build time.
 */

const BASE = (process.env.TNSA_API_BASE_URL ?? "https://embedding.tnsaai.com").replace(/\/$/, "");
const KEY = process.env.TNSA_API_KEY ?? "";

const OUTPUTS_MODEL = "tnsa-ngen-outputs-v1";

export class TnsaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "TnsaError";
  }
}

function headers(): HeadersInit {
  if (!KEY) throw new TnsaError("no_api_key", "TNSA_API_KEY is not set in .env.local");
  return { Authorization: `Bearer ${KEY}` };
}

/** Raw shape returned by POST /outputs. Only the fields the demo reads. */
export type OutputsResponse = {
  request_id: string;
  model: string;
  duration: number;
  audio?: { sample_rate: number; peak: number; rms: number };
  latency: {
    decode_ms?: number;
    stt_ms?: number;
    tagging_ms?: number;
    correction_ms?: number;
    embedding_ms?: number;
    total_ms: number;
    /** Added by this client: round trip including TLS and upload. */
    wall_ms?: number;
  };
  usage?: {
    audio_seconds: number;
    points: number;
    stt_windows: number;
    agen_calls: number;
    stt_hedges_issued: number;
    stt_hedges_won: number;
  };
  models?: { embedding?: string; stt?: string; agen?: string };
  embedding?: { vector: number[]; dim: number; normalized: boolean; model: string };
  transcript?: {
    text: string;
    raw_text: string;
    language: string | null;
    languages: string[];
    mixed_language: boolean;
    language_switch_count: number;
    segments: TranscriptSegment[];
    language_timeline: TimelineEntry[];
    corrected_segment_count?: number;
    segments_filtered?: number;
    windows?: number;
    prompt_versions?: { language_tagging?: string; transcript_correction?: string };
  };
};

export type TranscriptSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  raw_text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  window?: number;
  stt_language?: string;
  languages?: string[];
  primary?: string;
  language_confidence?: number;
  language_source?: string;
  corrected?: boolean;
};

export type TimelineEntry = {
  start: number;
  end: number;
  text: string;
  languages: string[];
  mixed_language: boolean;
};

type RunOptions = {
  engine: EngineKey;
  /** BCP-47-ish code, or "auto" to let the engine detect. */
  language?: string;
  /** Ask the correction pass to normalise into this language's native script. */
  targetLanguage?: string;
  /** Skip the 1024-dim embedding when the caller only needs text. */
  includeEmbedding?: boolean;
  chunkSeconds?: number;
  signal?: AbortSignal;
};

/**
 * Run one engine over one clip via POST /outputs.
 *
 * `/outputs` runs decode, STT windowing, language tagging, script correction and
 * embedding server-side in a single call. Doing it client-side across separate
 * `/stt` + `/agen` + `/audio/embeddings` requests is both slower and unable to
 * reach V2 at all.
 */
export async function runEngine(
  audio: Blob,
  filename: string,
  opts: RunOptions
): Promise<OutputsResponse> {
  const include = ["transcript", "languages", "correction"];
  if (opts.includeEmbedding !== false) include.unshift("embedding");

  const form = new FormData();
  form.set("audio", audio, filename);
  form.set("model", OUTPUTS_MODEL);
  form.set("stt_model", ENGINES[opts.engine].id);
  form.set("language", opts.language ?? "auto");
  form.set("include", include.join(","));
  if (opts.targetLanguage) form.set("target_language", opts.targetLanguage);
  if (opts.chunkSeconds) form.set("chunk_seconds", String(opts.chunkSeconds));

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${BASE}/outputs`, {
      method: "POST",
      headers: headers(),
      body: form,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new TnsaError(
      "transport_error",
      `Could not reach ${BASE}: ${(cause as Error).message}`,
      true
    );
  }

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TnsaError("bad_response", `Non-JSON response (HTTP ${response.status}): ${raw.slice(0, 300)}`);
  }

  const err = (parsed as { error?: { code: string; message: string; retryable?: boolean } }).error;
  if (err) throw new TnsaError(err.code, err.message, err.retryable ?? false);
  if (!response.ok) {
    throw new TnsaError("http_error", `HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }

  const payload = parsed as OutputsResponse;

  // Guard against a silent fallback: if the box ever stops honouring stt_model,
  // a V2-labelled column showing V1 output would quietly invalidate the whole
  // comparison. Better to fail loudly.
  const dispatched = payload.models?.stt;
  const expected = ENGINES[opts.engine].id;
  if (dispatched && dispatched !== expected) {
    throw new TnsaError(
      "engine_mismatch",
      `Requested ${expected} but the server ran ${dispatched}.`
    );
  }

  return { ...payload, latency: { ...payload.latency, wall_ms: Date.now() - started } };
}

export async function health(): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/health`, { cache: "no-store" });
  if (!response.ok) throw new TnsaError("http_error", `HTTP ${response.status}`);
  return response.json();
}

export const apiBase = BASE;
export const hasKey = () => Boolean(KEY);
