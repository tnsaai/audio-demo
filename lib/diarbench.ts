import "server-only";

import { DIARBENCH_CODES } from "./engines";

/**
 * Indic DiarBench (`sarvamai/indic-diarbench`) via the HF datasets-server.
 *
 * Each language config is a single ~1 GB parquet with embedded audio, so the
 * files cannot be fetched directly. The rows API serves individual records with
 * the audio broken out to a signed URL, which is the only workable access
 * pattern for a serverless deployment.
 *
 * Two things make this set very different from ARen, and both matter when
 * reading a score off it:
 *
 *  - Recordings are conversations of roughly 200 s with 6–8 speakers, not the
 *    2–40 s single-speaker clips ARen uses.
 *  - The reference is speaker-attributed. Concatenating it in time order gives
 *    a scoreable string, but the resulting WER charges the engine for speaker
 *    overlap and turn boundaries, which neither engine attempts to model.
 */

const ROWS_API = "https://datasets-server.huggingface.co/rows";
const DATASET = "sarvamai/indic-diarbench";

export type DiarSegment = {
  speaker_id: string;
  transcript: string;
  start_time: number;
  end_time: number;
};

export type DiarRow = {
  index: number;
  recordingId: string;
  sampleId: string;
  language: string;
  languageCode: string;
  datasetType: string;
  numSpeakers: number;
  numSegments: number;
  durationSeconds: number;
  /** Signed and short-lived — fetch promptly, do not persist. */
  audioUrl: string;
  reference: string;
};

type RowsResponse = {
  num_rows_total?: number;
  error?: string;
  rows?: Array<{
    row_idx: number;
    row: {
      audio?: Array<{ src?: string }>;
      recording_id?: string;
      sample_id?: string;
      language?: string;
      dataset_type?: string;
      num_speakers?: number;
      num_segments?: number;
      duration_seconds?: number;
      annotated_transcript?: DiarSegment[];
    };
  }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The rows API computes an index the first time a config is touched, so a cold
 * language can take tens of seconds or return 500 while it builds. Retrying
 * turns "this language is broken" into "this language is slow the first time".
 */
async function fetchRows(url: string, signal?: AbortSignal): Promise<RowsResponse | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: hfHeaders(),
        signal,
        // Cache the warm result; a cold config is expensive to recompute.
        next: { revalidate: 900 },
      });
      if (response.ok) {
        const payload = (await response.json()) as RowsResponse;
        // A config still being indexed answers with an error body, not a 5xx.
        if (!payload.error) return payload;
      } else if (response.status < 500 && response.status !== 429) {
        return null;
      }
    } catch (cause) {
      if ((cause as Error).name === "AbortError") throw cause;
    }
    if (attempt < 4) await sleep(2000 * attempt);
  }
  return null;
}

function hfHeaders(): HeadersInit {
  const token = process.env.HF_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Concatenate the speaker-attributed reference in time order. */
export function flattenReference(segments: DiarSegment[] | undefined): string {
  if (!segments?.length) return "";
  return [...segments]
    .sort((a, b) => a.start_time - b.start_time)
    .map((segment) => segment.transcript?.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The rows API caps `length` at 100 per request, so a larger page is stitched
 * from several calls.
 */
export async function listDiarRows(
  language: string,
  limit: number,
  signal?: AbortSignal
): Promise<{ rows: DiarRow[]; total: number }> {
  const code = DIARBENCH_CODES[language];
  if (!code) return { rows: [], total: 0 };

  const rows: DiarRow[] = [];
  let total = 0;
  const pageSize = 100;

  for (let offset = 0; offset < limit; offset += pageSize) {
    const length = Math.min(pageSize, limit - offset);
    const url =
      `${ROWS_API}?dataset=${encodeURIComponent(DATASET)}` +
      `&config=${encodeURIComponent(language)}&split=test&offset=${offset}&length=${length}`;

    const payload = await fetchRows(url, signal);
    if (!payload?.rows?.length) break;
    total = payload.num_rows_total ?? total;

    for (const entry of payload.rows) {
      const row = entry.row;
      const audioUrl = row.audio?.[0]?.src;
      const reference = flattenReference(row.annotated_transcript);
      // A row with no audio or no reference cannot be scored; skip rather than
      // emit a zero-word row that would skew corpus WER.
      if (!audioUrl || !reference) continue;
      rows.push({
        index: entry.row_idx,
        recordingId: row.recording_id ?? `row_${entry.row_idx}`,
        sampleId: row.sample_id ?? `row_${entry.row_idx}`,
        language,
        languageCode: code,
        datasetType: row.dataset_type ?? "unknown",
        numSpeakers: row.num_speakers ?? 0,
        numSegments: row.num_segments ?? 0,
        durationSeconds: row.duration_seconds ?? 0,
        audioUrl,
        reference,
      });
    }

    if (payload.rows.length < length) break;
  }

  return { rows, total: total || rows.length };
}

export async function fetchDiarAudio(
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
