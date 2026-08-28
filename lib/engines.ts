/**
 * The transcription engines this demo exposes.
 *
 * Model ids are exact and case-sensitive. `/stt` rejects `ngenstt-v2-large`
 * outright — both engines go through `/outputs` with `stt_model`.
 */
export const ENGINES = {
  v2: {
    id: "ngenstt-v2-large",
    key: "v2" as const,
    name: "NGenSTT-V2-Large",
    short: "V2",
    base: "QwenASR-1.7B",
    /** No post-pass; the acoustic model's output is taken as final. */
    correction: false,
    blurb: "QwenASR-1.7B. Strongest on Arabic and English; no Indic head beyond Hindi.",
  },
  v1indic: {
    id: "tnsa-ngen-stt-v1",
    key: "v1indic" as const,
    name: "NGenSTT-V1 Indic",
    short: "V1 Indic",
    base: "tnsa-ngen-stt-v1 + AGen (Qwen) script repair",
    /**
     * Runs the AGen correction pass over the STT output. That pass is what
     * rewrites Indic speech emitted phonetically into the wrong script —
     * Telugu written in Devanagari, for instance — into its native script.
     */
    correction: true,
    blurb: "Acoustic pass plus a Qwen correction stage that repairs Indic script.",
  },
} as const;

/**
 * Language codes `ngenstt-v2-large` accepts as a forced `language`.
 *
 * Measured against the live box: every other Indic code (te, ta, kn, ml, bn,
 * mr, gu, pa, ur) returns HTTP 500 rather than an error payload. Forcing one
 * crashes the request, so anything outside this set is downgraded to auto
 * detection. It also explains why V2 labels Telugu speech as Hindi — Hindi is
 * the nearest Indic language its head actually covers.
 */
export const V2_LANGUAGES = new Set(["auto", "ar", "en", "hi", "fa"]);

export type EngineKey = keyof typeof ENGINES;
export const ENGINE_KEYS: EngineKey[] = ["v2", "v1indic"];

export function isEngineKey(value: string): value is EngineKey {
  return value === "v2" || value === "v1indic";
}

/**
 * Published ARen results, 594 transcriptions.
 *
 * These predate the Indic correction stage: the `v1indic` column is the raw
 * `tnsa-ngen-stt-v1` acoustic pass, scored on Arabic and English where the
 * script-repair stage has nothing to do.
 */
export const PUBLISHED_RESULTS = [
  { lang: "Arabic", condition: "clean", v2: 8.1, v1indic: 12.2 },
  { lang: "Arabic", condition: "telephony 8 kHz", v2: 10.9, v1indic: 14.4 },
  { lang: "Arabic", condition: "telephony + noise", v2: 15.6, v1indic: 21.1 },
  { lang: "English", condition: "clean", v2: 6.0, v1indic: 9.6 },
  { lang: "English", condition: "telephony 8 kHz", v2: 6.8, v1indic: 10.8 },
  { lang: "English", condition: "telephony + noise", v2: 37.8, v1indic: 40.0 },
] as const;

export const CONDITIONS = [
  { id: "clean", label: "Clean", detail: "16 kHz mono, as published — studio or headset capture." },
  {
    id: "tel8k",
    label: "Telephony 8 kHz",
    detail: "Band-limited 300–3400 Hz then back to 16 kHz — PSTN / mobile.",
  },
  {
    id: "tel8k_noisy",
    label: "Telephony + noise",
    detail: "Telephony band-limiting plus additive brown noise.",
  },
] as const;

export type ConditionId = (typeof CONDITIONS)[number]["id"];

/** Benchmark suites the /benchmark page can run. */
export const BENCHMARKS = {
  aren: {
    id: "aren" as const,
    name: "ARen",
    repo: "TNSA/Aren",
    url: "https://huggingface.co/datasets/TNSA/Aren",
    languages: "Arabic + English",
    detail:
      "99 clips × 3 acoustic conditions, 2–40 s each, single speaker, with references and stored baseline hypotheses. Measures the degradation slope as the channel worsens.",
    conditions: true,
    scored: true,
  },
  diarbench: {
    id: "diarbench" as const,
    name: "Indic DiarBench",
    repo: "sarvamai/indic-diarbench",
    url: "https://huggingface.co/datasets/sarvamai/indic-diarbench",
    languages: "22 Indic languages",
    detail:
      "Multi-speaker conversations, roughly 200 s each with 6–8 speakers. Reference is a speaker-attributed transcript, concatenated in time order for scoring.",
    conditions: false,
    scored: true,
  },
} as const;

export type BenchmarkId = keyof typeof BENCHMARKS;

/** Config names as they appear in the indic-diarbench repo. */
export const DIARBENCH_LANGUAGES = [
  "Assamese", "Bengali", "Bodo", "Dogri", "Gujarati", "Hindi", "Kannada",
  "Kashmiri", "Konkani", "Maithili", "Malayalam", "Manipuri", "Marathi",
  "Nepali", "Odia", "Punjabi", "Sanskrit", "Santali", "Sindhi", "Tamil",
  "Telugu", "Urdu",
] as const;

/** Config name -> ISO code, for language tagging and script checks. */
export const DIARBENCH_CODES: Record<string, string> = {
  Assamese: "as", Bengali: "bn", Bodo: "brx", Dogri: "doi", Gujarati: "gu",
  Hindi: "hi", Kannada: "kn", Kashmiri: "ks", Konkani: "kok", Maithili: "mai",
  Malayalam: "ml", Manipuri: "mni", Marathi: "mr", Nepali: "ne", Odia: "or",
  Punjabi: "pa", Sanskrit: "sa", Santali: "sat", Sindhi: "sd", Tamil: "ta",
  Telugu: "te", Urdu: "ur",
};
