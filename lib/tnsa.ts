import "server-only";

import { ENGINES, V2_LANGUAGES, type EngineKey } from "./engines";
import { LANGUAGE_NAMES } from "./lang";

/**
 * Server-side client for the TNSA Audio API on the GH200 box.
 *
 * The API key lives only in this module's process. Nothing here is ever
 * imported into a client component — `server-only` enforces that at build time.
 */

const BASE = (process.env.TNSA_API_BASE_URL ?? "https://embedding.tnsaai.com").replace(/\/$/, "");
const KEY = process.env.TNSA_API_KEY ?? "";

const OUTPUTS_MODEL = "tnsa-ngen-outputs-v1";
const AGEN_MODEL = "agen-multilingual-v1";

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
  /** Set when the Indic correction pass failed but the acoustic result stands. */
  correctionError?: string;
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
  // V2 hard-500s on Indic codes it does not cover, so an unsupported request
  // becomes auto detection rather than a crashed run.
  const requested = opts.language ?? "auto";
  const language =
    opts.engine === "v2" && !V2_LANGUAGES.has(requested) ? "auto" : requested;
  form.set("language", language);
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

  if (!ENGINES[opts.engine].correction) {
    return { ...payload, latency: { ...payload.latency, wall_ms: Date.now() - started } };
  }

  // Indic engine: run the Qwen script-repair pass over the acoustic output.
  const transcript = payload.transcript;
  const target = opts.targetLanguage || opts.language || transcript?.language;
  if (!transcript?.segments?.length || !target || target === "auto") {
    return { ...payload, latency: { ...payload.latency, wall_ms: Date.now() - started } };
  }

  const correctionStarted = Date.now();
  let corrected: Map<number, string>;
  try {
    corrected = await correctSegments(
      transcript.segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        sourceLanguage: segment.primary ?? segment.stt_language ?? null,
      })),
      target,
      LANGUAGE_NAMES[target] ?? target,
      opts.signal
    );
  } catch (cause) {
    // A correction failure must not lose a good acoustic transcript. Return the
    // uncorrected result rather than failing the whole run.
    return {
      ...payload,
      latency: { ...payload.latency, wall_ms: Date.now() - started },
      correctionError: (cause as Error).message,
    };
  }

  const segments = transcript.segments.map((segment) => {
    const text = corrected.get(segment.id);
    if (!text || text === segment.text) return segment;
    return { ...segment, raw_text: segment.text, text, corrected: true };
  });
  const changed = segments.filter((segment) => segment.corrected).length;

  return {
    ...payload,
    transcript: {
      ...transcript,
      raw_text: transcript.text,
      text: segments.map((segment) => segment.text).join(" ").trim(),
      segments,
      corrected_segment_count: changed,
    },
    latency: {
      ...payload.latency,
      correction_ms: Date.now() - correctionStarted,
      wall_ms: Date.now() - started,
    },
  };
}

/**
 * AGen (Qwen) transcript correction.
 *
 * The acoustic pass can emit Indic speech phonetically in the wrong script —
 * Telugu written in Devanagari reads as fluent nonsense and no script check
 * catches it, because the language tag is wrong too. This pass rewrites each
 * segment into the target language's native script.
 *
 * It is slow: roughly 15–20 s per call on the clips tested. That cost is the
 * whole reason it is a separate engine rather than always-on.
 */
export async function correctSegments(
  segments: Array<{ id: number; text: string; sourceLanguage?: string | null }>,
  targetLanguage: string,
  targetLanguageName: string,
  signal?: AbortSignal
): Promise<Map<number, string>> {
  const usable = segments.filter((segment) => segment.text.trim());
  if (!usable.length) return new Map();

  const body = {
    model: AGEN_MODEL,
    task: "transcript_correction",
    segments: usable.map((segment, index) => ({
      id: segment.id,
      source_language_code: segment.sourceLanguage || "unknown",
      target_language_code: targetLanguage,
      target_language: targetLanguageName,
      script_mismatch: true,
      transcript: segment.text,
      previous_context: usable[index - 1]?.text.slice(-500) ?? "",
      next_context: usable[index + 1]?.text.slice(0, 500) ?? "",
    })),
    options: { temperature: 0, reasoning: false },
  };

  const response = await fetch(`${BASE}/agen`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new TnsaError("agen_error", `AGen HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const parsed = (await response.json()) as {
    error?: { code: string; message: string };
    segments?: Array<{ id: number; corrected_text?: string; changed?: boolean }>;
  };
  if (parsed.error) throw new TnsaError(parsed.error.code, parsed.error.message);

  const out = new Map<number, string>();
  for (const segment of parsed.segments ?? []) {
    const text = segment.corrected_text?.trim();
    if (text) out.set(segment.id, text);
  }
  return out;
}

export async function health(): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/health`, { cache: "no-store" });
  if (!response.ok) throw new TnsaError("http_error", `HTTP ${response.status}`);
  return response.json();
}

export const apiBase = BASE;
export const hasKey = () => Boolean(KEY);
