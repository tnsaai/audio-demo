/**
 * Word error rate with a substitution / deletion / insertion breakdown.
 *
 * Ported from the ARen reference scorer (`aren/scripts/aren_eval.py`) so the
 * numbers this demo shows line up with the published benchmark. The Arabic
 * normalisation is not cosmetic: without it you measure orthographic convention
 * rather than recognition, which inflates WER by several points.
 */

const ARABIC_DIACRITICS = /[ً-ْٰ]/g;
const PUNCTUATION = /[.,!?;:،؟"'\-–—()]/g;

const ARABIC_FOLDS: Array<[RegExp, string]> = [
  [/[أإآ]/g, "ا"],
  [/ة/g, "ه"],
  [/ى/g, "ي"],
];

/**
 * Signatures of caption-scraped training data. Their presence marks output that
 * was fabricated rather than misheard — the failure mode WER alone cannot see.
 */
const HALLUCINATION_MARKERS = [
  "اشتركوا في القناة",
  "اشتراك في القناة",
  "المزيد من الفيديوهات",
  "شكرا للمشاهدة",
  "subscribe to the channel",
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
];

export function normalizeWords(text: string, language?: string): string[] {
  let out = (text ?? "").normalize("NFKC");
  if (language === "ar") {
    out = out.replace(ARABIC_DIACRITICS, "");
    for (const [pattern, replacement] of ARABIC_FOLDS) out = out.replace(pattern, replacement);
  }
  out = out.replace(PUNCTUATION, " ");
  return out.toLowerCase().split(/\s+/).filter(Boolean);
}

export type EditCounts = { substitutions: number; deletions: number; insertions: number };

/** Levenshtein alignment, backtracked to attribute each edit to a class. */
export function editCounts(reference: string[], hypothesis: string[]): EditCounts {
  const n = reference.length;
  const m = hypothesis.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    const cost = i > 0 && j > 0 && reference[i - 1] !== hypothesis[j - 1] ? 1 : 0;
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost) {
      if (cost) substitutions++;
      i--;
      j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      insertions++;
      j--;
    } else {
      deletions++;
      i--;
    }
  }
  return { substitutions, deletions, insertions };
}

export type Score = EditCounts & {
  referenceWords: number;
  hypothesisWords: number;
  wer: number;
  insertionRate: number;
  hallucinated: boolean;
  empty: boolean;
};

export function score(reference: string, hypothesis: string, language?: string): Score {
  const ref = normalizeWords(reference, language);
  const hyp = normalizeWords(hypothesis, language);
  const counts = editCounts(ref, hyp);
  const errors = counts.substitutions + counts.deletions + counts.insertions;
  const lower = (hypothesis ?? "").toLowerCase();
  return {
    ...counts,
    referenceWords: ref.length,
    hypothesisWords: hyp.length,
    wer: ref.length ? errors / ref.length : 0,
    insertionRate: ref.length ? counts.insertions / ref.length : 0,
    hallucinated: HALLUCINATION_MARKERS.some((marker) => lower.includes(marker)),
    empty: hyp.length === 0,
  };
}

/** Word-level alignment for rendering a coloured diff against the reference. */
export type DiffOp = { type: "equal" | "sub" | "del" | "ins"; ref?: string; hyp?: string };

export function diff(reference: string, hypothesis: string, language?: string): DiffOp[] {
  const ref = normalizeWords(reference, language);
  const hyp = normalizeWords(hypothesis, language);
  const n = ref.length;
  const m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cost = i > 0 && j > 0 && ref[i - 1] !== hyp[j - 1] ? 1 : 0;
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost) {
      ops.push(cost ? { type: "sub", ref: ref[i - 1], hyp: hyp[j - 1] } : { type: "equal", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      ops.push({ type: "ins", hyp: hyp[j - 1] });
      j--;
    } else {
      ops.push({ type: "del", ref: ref[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}

export const formatPercent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
