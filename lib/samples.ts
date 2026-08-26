import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ConditionId } from "./engines";

/**
 * The sample bank has two sources:
 *
 *   1. ARen — the Arabic/English robustness set, which ships references and
 *      stored baseline hypotheses so a run can be scored immediately.
 *   2. A drop-in folder (CUSTOM_AUDIO_DIR) for anything else, notably Indic
 *      audio, which ARen does not cover. Clips there have no reference text,
 *      so they run without scoring.
 *
 * Both are optional. With neither configured, upload and record still work.
 */

const AREN_DIR = process.env.AREN_DIR?.trim() || "";
const CUSTOM_DIR = process.env.CUSTOM_AUDIO_DIR?.trim() || "";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"]);

export type Sample = {
  id: string;
  origin: "aren" | "custom";
  label: string;
  language: string | null;
  source: string;
  duration: number | null;
  /** Reference transcript, when the sample has one. */
  reference: string | null;
  /** Conditions this clip exists in. Custom clips have exactly one. */
  conditions: ConditionId[];
  /** Stored benchmark hypotheses, when published for this condition. */
  baseline: Partial<Record<ConditionId, { v2: string | null; v1: string | null }>>;
};

type ArenRow = {
  file_name: string;
  transcription: string;
  language: string;
  source: string;
  duration: number;
  ngenstt_v2_text?: string;
  oaw_distillgen_text?: string;
};

let cache: { samples: Sample[]; at: number } | null = null;
const CACHE_MS = 30_000;

async function readArenRows(condition: ConditionId): Promise<ArenRow[]> {
  if (!AREN_DIR) return [];
  try {
    const raw = await readFile(path.join(AREN_DIR, `${condition}.jsonl`), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ArenRow);
  } catch {
    return [];
  }
}

async function loadAren(): Promise<Sample[]> {
  const byId = new Map<string, Sample>();
  for (const condition of ["clean", "tel8k", "tel8k_noisy"] as ConditionId[]) {
    for (const row of await readArenRows(condition)) {
      const id = path.basename(row.file_name, path.extname(row.file_name));
      const existing = byId.get(id);
      const sample: Sample =
        existing ??
        {
          id,
          origin: "aren",
          label: id,
          language: row.language,
          source: row.source,
          duration: row.duration ?? null,
          reference: row.transcription,
          conditions: [],
          baseline: {},
        };
      if (!sample.conditions.includes(condition)) sample.conditions.push(condition);
      if (row.ngenstt_v2_text || row.oaw_distillgen_text) {
        sample.baseline[condition] = {
          v2: row.ngenstt_v2_text ?? null,
          v1: row.oaw_distillgen_text ?? null,
        };
      }
      byId.set(id, sample);
    }
  }
  // Stable order: Arabic first (the harder, more interesting half), then by id.
  return [...byId.values()].sort((a, b) => {
    if (a.language !== b.language) return a.language === "ar" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

async function loadCustom(): Promise<Sample[]> {
  if (!CUSTOM_DIR) return [];
  let entries: string[];
  try {
    entries = await readdir(CUSTOM_DIR);
  } catch {
    return [];
  }
  const out: Sample[] = [];
  for (const entry of entries) {
    if (!AUDIO_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
    const full = path.join(CUSTOM_DIR, entry);
    try {
      if (!(await stat(full)).isFile()) continue;
    } catch {
      continue;
    }
    const base = path.basename(entry, path.extname(entry));
    // Convention: a leading language code, e.g. "hi_loan_query.wav" or
    // "ta-balance.wav", tags the clip without needing a manifest.
    const tag = /^([a-z]{2})[_-]/i.exec(base)?.[1]?.toLowerCase() ?? null;
    out.push({
      id: `custom:${entry}`,
      origin: "custom",
      label: base.replace(/[_-]+/g, " "),
      language: tag,
      source: "drop-in",
      duration: null,
      reference: null,
      conditions: ["clean"],
      baseline: {},
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function listSamples(): Promise<Sample[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.samples;
  const samples = [...(await loadAren()), ...(await loadCustom())];
  cache = { samples, at: Date.now() };
  return samples;
}

/** Resolve a sample id + condition to an absolute path, refusing traversal. */
export async function resolveSamplePath(
  id: string,
  condition: ConditionId
): Promise<{ file: string; name: string } | null> {
  if (id.startsWith("custom:")) {
    if (!CUSTOM_DIR) return null;
    const name = id.slice("custom:".length);
    if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
    const file = path.resolve(CUSTOM_DIR, name);
    if (!file.startsWith(path.resolve(CUSTOM_DIR))) return null;
    return { file, name };
  }

  if (!AREN_DIR) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const name = `${id}.wav`;
  const file = path.resolve(AREN_DIR, "data", condition, name);
  if (!file.startsWith(path.resolve(AREN_DIR))) return null;
  return { file, name };
}

export const sampleBankConfigured = () => Boolean(AREN_DIR || CUSTOM_DIR);
export const arenConfigured = () => Boolean(AREN_DIR);
export const customDir = () => CUSTOM_DIR;
