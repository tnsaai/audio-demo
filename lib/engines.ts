/**
 * The two transcription engines this demo compares.
 *
 * Model ids are exact and case-sensitive. Note that `/stt` rejects
 * `ngenstt-v2-large` outright — V2 is reachable only through the unified
 * `/outputs` and `/v1/process` routes, passed as `stt_model`.
 */
export const ENGINES = {
  v2: {
    id: "ngenstt-v2-large",
    key: "v2" as const,
    name: "NGenSTT-V2-Large",
    short: "V2",
    base: "NGen-4-Lite-ASR",
    blurb: "Current generation. Holds together under telephony bandwidth and noise.",
  },
  v1: {
    id: "tnsa-ngen-stt-v1",
    key: "v1" as const,
    name: "OAW-DistillGen-AudioSTT",
    short: "V1",
    base: "Whisper-derived distillation",
    blurb: "Previous generation. Faster, but degrades sharply on real recordings.",
  },
} as const;

export type EngineKey = keyof typeof ENGINES;
export const ENGINE_KEYS: EngineKey[] = ["v2", "v1"];

export function isEngineKey(value: string): value is EngineKey {
  return value === "v2" || value === "v1";
}

/**
 * Published ARen results, 594 transcriptions across the full set.
 * WER as a percentage; lower is better.
 */
export const PUBLISHED_RESULTS = [
  { lang: "Arabic", condition: "clean", v2: 8.1, v1: 12.2 },
  { lang: "Arabic", condition: "telephony 8 kHz", v2: 10.9, v1: 14.4 },
  { lang: "Arabic", condition: "telephony + noise", v2: 15.6, v1: 21.1 },
  { lang: "English", condition: "clean", v2: 6.0, v1: 9.6 },
  { lang: "English", condition: "telephony 8 kHz", v2: 6.8, v1: 10.8 },
  { lang: "English", condition: "telephony + noise", v2: 37.8, v1: 40.0 },
] as const;

export const CONDITIONS = [
  {
    id: "clean",
    label: "Clean",
    detail: "16 kHz mono, as published — studio or headset capture.",
  },
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
