/**
 * Language and script helpers for the two families this demo cares about:
 * the Indic languages and Arabic.
 *
 * Script detection matters here because the characteristic failure is not a
 * mishearing — it is speech emitted phonetically into the *wrong* script
 * (Telugu written in Gujarati letters, Arabic romanised into Latin). Rendering
 * the detected script next to the language tag makes that visible instead of
 * leaving it buried in a WER number.
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  ar: "Arabic",
  as: "Assamese",
  bn: "Bengali",
  en: "English",
  fa: "Persian",
  gu: "Gujarati",
  he: "Hebrew",
  hi: "Hindi",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  ne: "Nepali",
  or: "Odia",
  pa: "Punjabi",
  ps: "Pashto",
  sa: "Sanskrit",
  sd: "Sindhi",
  si: "Sinhala",
  ta: "Tamil",
  te: "Telugu",
  ur: "Urdu",
};

/** Languages offered in the forced-language picker, grouped for the UI. */
export const LANGUAGE_GROUPS = [
  {
    label: "Indian languages",
    codes: ["hi", "bn", "ta", "te", "kn", "ml", "mr", "gu", "pa", "or", "as", "ur", "sa", "ne"],
  },
  { label: "Arabic & neighbours", codes: ["ar", "fa", "ur", "ps", "sd", "he"] },
  { label: "Other", codes: ["en"] },
] as const;

export const INDIC_CODES = new Set([
  "hi", "bn", "ta", "te", "kn", "ml", "mr", "gu", "pa", "or", "as", "sa", "ne", "si", "ur", "sd",
]);

export const RTL_CODES = new Set(["ar", "fa", "ur", "ps", "sd", "he"]);

const SCRIPT_RANGES: Array<[string, RegExp]> = [
  ["Arabic", /[؀-ۿݐ-ݿ]/],
  ["Devanagari", /[ऀ-ॿ]/],
  ["Bengali", /[ঀ-৿]/],
  ["Gurmukhi", /[਀-੿]/],
  ["Gujarati", /[઀-૿]/],
  ["Odia", /[଀-୿]/],
  ["Tamil", /[஀-௿]/],
  ["Telugu", /[ఀ-౿]/],
  ["Kannada", /[ಀ-೿]/],
  ["Malayalam", /[ഀ-ൿ]/],
  ["Sinhala", /[඀-෿]/],
  ["Hebrew", /[֐-׿]/],
  ["Latin", /[A-Za-z]/],
];

/** The native script a language is normally written in. */
const NATIVE_SCRIPT: Record<string, string> = {
  ar: "Arabic", fa: "Arabic", ur: "Arabic", ps: "Arabic", sd: "Arabic",
  he: "Hebrew", en: "Latin",
  hi: "Devanagari", mr: "Devanagari", sa: "Devanagari", ne: "Devanagari",
  bn: "Bengali", as: "Bengali",
  pa: "Gurmukhi", gu: "Gujarati", or: "Odia",
  ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", si: "Sinhala",
};

/** Every script present in the text, most-used first. */
export function detectScripts(text: string): string[] {
  const counts = new Map<string, number>();
  for (const [name, pattern] of SCRIPT_RANGES) {
    const matches = text.match(new RegExp(pattern.source, "g"));
    if (matches?.length) counts.set(name, matches.length);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

export type ScriptCheck = {
  scripts: string[];
  expected: string | null;
  /** True when the dominant script is not the language's native one. */
  mismatch: boolean;
  /** True when more than one script appears — normal for code-switched speech. */
  mixed: boolean;
};

export function checkScript(text: string, language?: string | null): ScriptCheck {
  const scripts = detectScripts(text);
  const expected = language ? NATIVE_SCRIPT[language] ?? null : null;
  const dominant = scripts[0] ?? null;
  return {
    scripts,
    expected,
    // Latin alongside an Indic or Arabic script is ordinary code-switching, not
    // a script failure, so only flag when the *dominant* script is wrong.
    mismatch: Boolean(expected && dominant && dominant !== expected && dominant !== "Latin"),
    mixed: scripts.length > 1,
  };
}

export const languageName = (code?: string | null) =>
  (code && (LANGUAGE_NAMES[code] ?? code.toUpperCase())) || "Unknown";

export const isRtl = (code?: string | null) => Boolean(code && RTL_CODES.has(code));
