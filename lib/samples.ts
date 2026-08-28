import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ConditionId } from "./engines";
import { DIARBENCH_CODES } from "./engines";
import { fetchDiarAudio, listDiarRows } from "./diarbench";

/**
 * The sample bank, backed by the ARen dataset on Hugging Face.
 *
 * Serverless hosts have no persistent local filesystem, so the dataset is read
 * over HTTP rather than from disk. `AREN_DIR` still overrides it for local
 * development, which keeps the demo usable offline and avoids hammering the
 * HF CDN during a long benchmark run.
 *
 * Layout note: the JSONL manifests live at the repo root and their `file_name`
 * fields are relative paths like `data/clean/x.wav`, but the audio was uploaded
 * one level down under `aren/`. So the resolved object path is
 * `aren/<file_name>` — mirroring the manifest verbatim gives a 404.
 */

const HF_REPO = process.env.HF_DATASET_REPO?.trim() || "TNSA/Aren";
const HF_REVISION = process.env.HF_DATASET_REVISION?.trim() || "main";
const HF_TOKEN = process.env.HF_TOKEN?.trim() || "";

const AREN_DIR = process.env.AREN_DIR?.trim() || "";
const CUSTOM_DIR = process.env.CUSTOM_AUDIO_DIR?.trim() || "";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"]);
const CONDITION_IDS: ConditionId[] = ["clean", "tel8k", "tel8k_noisy"];

const hfBase = () =>
  `https://huggingface.co/datasets/${HF_REPO}/resolve/${encodeURIComponent(HF_REVISION)}`;

function hfHeaders(): HeadersInit {
  // Only needed for a gated or private dataset; TNSA/Aren is public.
  return HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
}

/** Public CDN URL for a clip, safe to hand straight to the browser. */
export function hfAudioUrl(id: string, condition: ConditionId): string {
  return `${hfBase()}/aren/data/${condition}/${id}.wav`;
}

export type Sample = {
  id: string;
  origin: "aren" | "custom" | "diarbench";
  label: string;
  language: string | null;
  source: string;
  duration: number | null;
  reference: string | null;
  conditions: ConditionId[];
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
const CACHE_MS = 10 * 60 * 1000;

async function readManifest(condition: ConditionId): Promise<ArenRow[]> {
  let raw: string;
  try {
    if (AREN_DIR) {
      raw = await readFile(path.join(AREN_DIR, `${condition}.jsonl`), "utf8");
    } else {
      const response = await fetch(`${hfBase()}/${condition}.jsonl`, {
        headers: hfHeaders(),
        // Manifests are small and change rarely; let the platform cache them.
        next: { revalidate: 3600 },
      });
      if (!response.ok) return [];
      raw = await response.text();
    }
  } catch {
    return [];
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ArenRow];
      } catch {
        return [];
      }
    });
}

async function loadAren(): Promise<Sample[]> {
  const byId = new Map<string, Sample>();
  for (const condition of CONDITION_IDS) {
    for (const row of await readManifest(condition)) {
      const id = path.basename(row.file_name, path.extname(row.file_name));
      const sample: Sample =
        byId.get(id) ??
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
  // Arabic first — the harder, more interesting half — then by id.
  return [...byId.values()].sort((a, b) => {
    if (a.language !== b.language) return a.language === "ar" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** Local drop-in clips. Development only — serverless has nowhere to put these. */
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
    // Convention: a leading language code — "hi_loan_query.wav", "ta-balance.wav".
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

/**
 * Indic clips from DiarBench, for one language config.
 *
 * Fetched on demand rather than eagerly: there are 22 language configs and
 * listing them all would mean 22 round trips before the picker could render.
 * Ids carry the language and row index so the signed audio URL — which expires —
 * can be re-resolved at play time instead of being cached.
 */
export async function listIndicSamples(language: string): Promise<Sample[]> {
  if (!DIARBENCH_CODES[language]) return [];
  const { rows } = await listDiarRows(language, 25);
  return rows.map((row) => ({
    id: `diar:${language}:${row.index}`,
    origin: "diarbench" as const,
    label: row.recordingId,
    language: row.languageCode,
    source: row.datasetType,
    duration: row.durationSeconds,
    reference: row.reference,
    conditions: ["clean"] as ConditionId[],
    baseline: {},
  }));
}

export async function listSamples(): Promise<Sample[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.samples;
  const samples = [...(await loadAren()), ...(await loadCustom())];
  // Only cache a real result; a transient HF failure must not pin an empty bank
  // in memory for the next ten minutes.
  if (samples.length) cache = { samples, at: Date.now() };
  return samples;
}

function safeCustomPath(id: string): string | null {
  if (!CUSTOM_DIR) return null;
  const name = id.slice("custom:".length);
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  const file = path.resolve(CUSTOM_DIR, name);
  return file.startsWith(path.resolve(CUSTOM_DIR)) ? file : null;
}

export type LoadedAudio = {
  /**
   * Explicitly `Uint8Array<ArrayBuffer>`: TypeScript widens a Node Buffer to
   * `ArrayBufferLike`, which neither `Blob` nor Web Crypto accepts.
   */
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  contentType: string;
};

/** Copy into a freshly allocated ArrayBuffer so the type is concrete. */
function toBytes(source: ArrayBufferView | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const view =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const out = new Uint8Array(new ArrayBuffer(view.byteLength));
  out.set(view);
  return out;
}

/**
 * Fetch a clip's bytes for forwarding to the inference API.
 *
 * Local disk wins when `AREN_DIR` is set; otherwise it comes from the HF CDN.
 */
export async function loadSampleAudio(
  id: string,
  condition: ConditionId
): Promise<LoadedAudio | null> {
  if (id.startsWith("custom:")) {
    const file = safeCustomPath(id);
    if (!file) return null;
    try {
      const bytes = await readFile(file);
      const extension = path.extname(file).toLowerCase();
      return {
        bytes: toBytes(bytes),
        name: path.basename(file),
        contentType: MIME[extension] ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  if (id.startsWith("diar:")) {
    const [, language, rawIndex] = id.split(":");
    const index = Number(rawIndex);
    if (!DIARBENCH_CODES[language] || !Number.isInteger(index)) return null;
    // The signed URL is short-lived, so the row is re-listed to get a fresh one.
    const { rows } = await listDiarRows(language, 25);
    const row = rows.find((item) => item.index === index);
    if (!row) return null;
    const bytes = await fetchDiarAudio(row.audioUrl);
    return bytes ? { bytes, name: `${row.recordingId}.wav`, contentType: "audio/wav" } : null;
  }

  // Ids come from the manifest, but this also backstops a hand-crafted request.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (!CONDITION_IDS.includes(condition)) return null;
  const name = `${id}.wav`;

  if (AREN_DIR) {
    try {
      const bytes = await readFile(path.resolve(AREN_DIR, "data", condition, name));
      return { bytes: toBytes(bytes), name, contentType: "audio/wav" };
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(hfAudioUrl(id, condition), {
      headers: hfHeaders(),
      cache: "force-cache",
    });
    if (!response.ok) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      name,
      contentType: response.headers.get("content-type") ?? "audio/wav",
    };
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};

/**
 * Where the browser should fetch a clip for playback.
 *
 * HF-backed clips redirect to the CDN so audio never streams through a
 * serverless function; local and drop-in clips have to be proxied.
 */
export function playbackRedirect(id: string, condition: ConditionId): string | null {
  if (id.startsWith("custom:") || id.startsWith("diar:") || AREN_DIR) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !CONDITION_IDS.includes(condition)) return null;
  return hfAudioUrl(id, condition);
}

export const datasetSource = () => (AREN_DIR ? `local:${AREN_DIR}` : `hf:${HF_REPO}@${HF_REVISION}`);
export const customDir = () => CUSTOM_DIR;
