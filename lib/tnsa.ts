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

/** Statuses worth retrying: gateway hiccups and upstream restarts, not 4xx. */
const RETRYABLE = new Set([429, 500, 502, 503, 504, 520, 521, 522, 524]);
const MAX_ATTEMPTS = 3;

/**
 * Turn a gateway failure into something readable.
 *
 * A 502 from Cloudflare is a full HTML error page; dumping it into the failures
 * list buries the actual signal under markup.
 */
function describeFailure(status: number, body: string): string {
  const looksHtml = /^\s*<(!doctype|html)/i.test(body);
  if (looksHtml || !body.trim()) {
    const hint =
      status === 502 || status === 503 || status === 504
        ? " — the inference box is unreachable or restarting"
        : status === 524
          ? " — the request exceeded the gateway timeout"
          : "";
    return `gateway error (HTTP ${status})${hint}`;
  }
  return `HTTP ${status}: ${body.slice(0, 200)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  /** Language the correction targeted, when inferred rather than detected. */
  correctionTarget?: string;
  correctionTargetSource?: "cross-engine";
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
  /** Return the raw acoustic result; the caller applies correction itself. */
  skipCorrection?: boolean;
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
  // Keyed off the model id, not the engine key — more than one engine runs the
  // same acoustic model and they all inherit its language limits.
  const requested = opts.language ?? "auto";
  const language =
    ENGINES[opts.engine].id === "ngenstt-v2-large" && !V2_LANGUAGES.has(requested)
      ? "auto"
      : requested;
  form.set("language", language);
  form.set("include", include.join(","));
  if (opts.targetLanguage) form.set("target_language", opts.targetLanguage);
  if (opts.chunkSeconds) form.set("chunk_seconds", String(opts.chunkSeconds));

  const started = Date.now();

  // A shared GPU box restarts, and the gateway in front of it returns 502/504
  // during that window. Retrying a handful of times turns a whole failed
  // benchmark run into a few slow rows.
  let raw = "";
  let status = 0;
  let lastError: TnsaError | null = null;
  let parsed: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${BASE}/outputs`, {
        method: "POST",
        headers: headers(),
        body: form,
        signal: opts.signal,
        cache: "no-store",
      });
      status = response.status;
      raw = await response.text();
    } catch (cause) {
      if ((cause as Error).name === "AbortError") throw cause;
      lastError = new TnsaError(
        "transport_error",
        `Could not reach ${BASE}: ${(cause as Error).message}`,
        true
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }

    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (parsed === null) {
      lastError = new TnsaError("gateway_error", describeFailure(status, raw), RETRYABLE.has(status));
      if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }
    break;
  }

  const err = (parsed as { error?: { code: string; message: string; retryable?: boolean } }).error;
  if (err) throw new TnsaError(err.code, err.message, err.retryable ?? false);
  if (status && status >= 400) {
    throw new TnsaError("http_error", describeFailure(status, raw));
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

  const withWall = { ...payload, latency: { ...payload.latency, wall_ms: Date.now() - started } };
  if (opts.skipCorrection || !ENGINES[opts.engine].correction) return withWall;
  return applyCorrection(withWall, opts);
}

/** Run the AGen (Qwen) script-repair pass over an acoustic result. */
export async function applyCorrection(
  payload: OutputsResponse,
  opts: { language?: string; targetLanguage?: string; signal?: AbortSignal }
): Promise<OutputsResponse> {
  const started = Date.now();
  const transcript = payload.transcript;
  // "auto" is a request to detect, not a language. Treating it as one made the
  // correction bail out silently whenever the picker was left on Auto detect —
  // which is the default, so the Indic engines did nothing at all.
  const forced =
    opts.targetLanguage && opts.targetLanguage !== "auto"
      ? opts.targetLanguage
      : opts.language && opts.language !== "auto"
        ? opts.language
        : null;
  const target = forced ?? transcript?.language ?? null;
  if (!transcript?.segments?.length || !target) return payload;

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
    return { ...payload, correctionError: (cause as Error).message };
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
      wall_ms: (payload.latency.wall_ms ?? 0) + (Date.now() - started),
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

  // The same retry the STT call gets. Without it a single transient 502 on a
  // shared box fails the whole correction and the panel shows "correction
  // failed" for what is really a one-second blip.
  let raw = "";
  let status = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${BASE}/agen`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });
    } catch (cause) {
      if ((cause as Error).name === "AbortError") throw cause;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw new TnsaError("transport_error", `AGen unreachable: ${(cause as Error).message}`, true);
    }

    status = response.status;
    raw = await response.text();
    if (response.ok) break;

    if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS) {
      await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
    throw new TnsaError("agen_error", describeFailure(status, raw), RETRYABLE.has(status));
  }

  const parsed = JSON.parse(raw) as {
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

/**
 * Run a set of engines over one clip, sharing acoustic work.
 *
 * Several engines can wrap the same acoustic model — V2 and V2+AGen both run
 * `ngenstt-v2-large` and differ only in the correction stage. Issuing that
 * model twice doubles GPU load for no new information, and on a long clip it
 * pushes both requests past the gateway timeout. So each distinct model runs
 * once and the correction variants are derived from the shared result.
 */
export async function runEngines(
  audio: Blob,
  filename: string,
  engines: EngineKey[],
  opts: Omit<RunOptions, "engine">
): Promise<Map<EngineKey, { ok: true; result: OutputsResponse } | { ok: false; error: unknown }>> {
  const byModel = new Map<string, EngineKey[]>();
  for (const engine of engines) {
    const id = ENGINES[engine].id;
    byModel.set(id, [...(byModel.get(id) ?? []), engine]);
  }

  const out = new Map<EngineKey, { ok: true; result: OutputsResponse } | { ok: false; error: unknown }>();

  // Phase 1: every distinct acoustic model, once, in parallel.
  const acoustic = new Map<string, OutputsResponse>();
  await Promise.all(
    [...byModel.entries()].map(async ([modelId, group]) => {
      try {
        acoustic.set(
          modelId,
          await runEngine(audio, filename, { ...opts, engine: group[0], skipCorrection: true })
        );
      } catch (error) {
        for (const engine of group) out.set(engine, { ok: false, error });
      }
    })
  );

  /*
   * Phase 2: pick the correction target.
   *
   * `ngenstt-v2-large` only has heads for a handful of languages, so it reports
   * Telugu speech as Hindi and writes it phonetically in Devanagari. Asking the
   * corrector to turn that Devanagari into Hindi is a no-op — the text already
   * looks like Hindi. The other acoustic model does have those heads, so when
   * it reports a language the narrow model cannot even represent, that reading
   * is the more informative one and becomes the target for every correction.
   *
   * An explicitly forced language always wins over this inference.
   */
  const forced =
    opts.targetLanguage && opts.targetLanguage !== "auto"
      ? opts.targetLanguage
      : opts.language && opts.language !== "auto"
        ? opts.language
        : null;

  let inferred: string | null = null;
  if (!forced) {
    for (const [modelId, payload] of acoustic) {
      const detected = payload.transcript?.language;
      if (!detected) continue;
      if (modelId !== "ngenstt-v2-large" && !V2_LANGUAGES.has(detected)) {
        inferred = detected;
        break;
      }
    }
  }

  // Phase 3: correction variants, sequential — they share one AGen worker, so
  // firing them together only queues them behind each other.
  for (const [modelId, group] of byModel) {
    const base = acoustic.get(modelId);
    if (!base) continue;
    for (const engine of group) {
      if (!ENGINES[engine].correction || opts.skipCorrection) {
        out.set(engine, { ok: true, result: base });
        continue;
      }
      try {
        const corrected = await applyCorrection(base, {
          ...opts,
          targetLanguage: forced ?? inferred ?? undefined,
        });
        out.set(engine, {
          ok: true,
          result: inferred
            ? { ...corrected, correctionTargetSource: "cross-engine" as const, correctionTarget: inferred }
            : corrected,
        });
      } catch (error) {
        out.set(engine, { ok: false, error });
      }
    }
  }

  return out;
}
