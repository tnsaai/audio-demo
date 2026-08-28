"use client";

import { AlertTriangle, Check } from "lucide-react";

import { ENGINES, type EngineKey } from "@/lib/engines";
import { checkScript, isRtl, languageName } from "@/lib/lang";
import { formatPercent, score, type Score } from "@/lib/wer";
import { cn, ms } from "@/lib/cn";
import { Badge, Card, CardBody, CardHead, Label, Stat } from "./ui";
import { EmbeddingVis, VectorStats } from "./embedding-vis";

/** Mirrors the pieces of the /outputs payload the UI renders. */
export type EngineResult = {
  request_id: string;
  duration: number;
  latency: {
    decode_ms?: number;
    stt_ms?: number;
    tagging_ms?: number;
    correction_ms?: number;
    embedding_ms?: number;
    total_ms: number;
    wall_ms?: number;
  };
  usage?: {
    stt_windows: number;
    agen_calls: number;
    stt_hedges_issued: number;
    stt_hedges_won: number;
  };
  models?: { stt?: string };
  embedding?: { vector: number[]; dim: number };
  transcript?: {
    text: string;
    raw_text: string;
    language: string | null;
    languages: string[];
    mixed_language: boolean;
    language_switch_count: number;
    segments: Array<{
      id: number;
      start: number;
      end: number;
      text: string;
      raw_text?: string;
      primary?: string;
      languages?: string[];
      language_confidence?: number;
      language_source?: string;
      corrected?: boolean;
      avg_logprob?: number;
      no_speech_prob?: number;
    }>;
    corrected_segment_count?: number;
    windows?: number;
  };
};

export type Run =
  | { engine: EngineKey; ok: true; result: EngineResult }
  | { engine: EngineKey; ok: false; code: string; message: string };

export function EnginePanel({
  engineKey,
  run,
  reference,
  referenceLanguage,
  peerScore,
  showEmbedding,
  disagreesWith,
  busy,
}: {
  /** Named up front so the header renders before any result arrives. */
  engineKey: EngineKey;
  run: Run | null;
  reference: string | null;
  referenceLanguage: string | null;
  /** The other engine's score, so we can mark which side won. */
  peerScore?: Score | null;
  /** Render the 1024-dim vector alongside the transcript. */
  showEmbedding?: boolean;
  /** The other engine's detected language, when the two disagree. */
  disagreesWith?: string | null;
  busy?: boolean;
}) {
  const engine = ENGINES[engineKey];
  const tone: "v2" | "v1" | "v3" =
    engineKey === "v1indic" ? "v1" : engineKey === "v2indic" ? "v3" : "v2";

  return (
    <Card className="flex h-full flex-col">
      <CardHead className="flex items-center gap-2">
        <Badge tone={tone}>{engine.short}</Badge>
        <div>
          <div className="text-[14px] font-medium text-white">{engine.name}</div>
          <div className="text-[11px] text-[var(--color-muted)]">{engine.id}</div>
        </div>
      </CardHead>

      <CardBody className="flex-1 space-y-5">
        {busy ? (
          <div className="space-y-3 py-6">
            <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--color-raised)]" />
            <div className="h-3 w-full animate-pulse rounded bg-[var(--color-raised)]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--color-raised)]" />
          </div>
        ) : !run ? (
          <div className="py-10 text-center text-[13px] text-[var(--color-muted)]">
            Pick audio and run it.
          </div>
        ) : !run.ok ? (
          <div className="rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-bad)]">
              <AlertTriangle className="h-4 w-4" />
              {run.code}
            </div>
            <p className="mt-1 text-[12px] text-[var(--color-body)]">{run.message}</p>
          </div>
        ) : (
          <Body
            result={run.result}
            reference={reference}
            referenceLanguage={referenceLanguage}
            peerScore={peerScore}
            showEmbedding={showEmbedding}
            disagreesWith={disagreesWith}
            tone={tone}
          />
        )}
      </CardBody>
    </Card>
  );
}

function Body({
  result,
  reference,
  referenceLanguage,
  peerScore,
  showEmbedding,
  disagreesWith,
  tone,
}: {
  result: EngineResult;
  reference: string | null;
  referenceLanguage: string | null;
  peerScore?: Score | null;
  showEmbedding?: boolean;
  disagreesWith?: string | null;
  tone: "v2" | "v1" | "v3";
}) {
  const transcript = result.transcript;
  const text = transcript?.text ?? "";
  const language = transcript?.language ?? referenceLanguage;
  const scored = reference ? score(reference, text, referenceLanguage ?? undefined) : null;
  const script = checkScript(text, language);
  const rtl = isRtl(language);

  const wins = scored && peerScore ? scored.wer < peerScore.wer : false;
  const ties = scored && peerScore ? Math.abs(scored.wer - peerScore.wer) < 1e-9 : false;

  // The script check compares the output against the *claimed* language, so it
  // cannot see a failure where the language tag is itself wrong — Telugu speech
  // labelled Hindi and written phonetically in Devanagari looks self-consistent.
  // Cross-engine disagreement is the signal that catches that case, and it needs
  // no reference text, so it works on your own recordings too.
  const disagreement = Boolean(
    disagreesWith && language && disagreesWith !== language
  );

  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <Label>Transcript</Label>
          {transcript?.language ? <Badge>{languageName(transcript.language)}</Badge> : null}
          {script.scripts.length ? (
            <Badge title="Unicode scripts present in the output">
              {script.scripts.join(" + ")} script
            </Badge>
          ) : null}
          {script.mismatch ? (
            <Badge tone="bad" title={`Expected ${script.expected} for ${languageName(language)}`}>
              wrong script
            </Badge>
          ) : null}
          {transcript?.mixed_language ? (
            <Badge tone="warn">{transcript.language_switch_count} switches</Badge>
          ) : null}
          {disagreement ? (
            <Badge
              tone="bad"
              title={`The other engine detected ${languageName(disagreesWith)}. When the two disagree on language, one of them is transliterating rather than transcribing.`}
            >
              disputed: other engine says {languageName(disagreesWith)}
            </Badge>
          ) : null}
        </div>
        <p
          className={cn(
            "script-text mt-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-3",
            rtl && "rtl"
          )}
        >
          {text || <span className="text-[var(--color-muted)]">(empty)</span>}
        </p>
        {transcript?.raw_text && transcript.raw_text !== text ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-[var(--color-muted)] hover:text-white">
              Show pre-correction output
            </summary>
            <p className={cn("script-text mt-2 text-[var(--color-muted)]", rtl && "rtl")}>
              {transcript.raw_text}
            </p>
          </details>
        ) : null}
      </div>

      {scored ? (
        <div className="grid grid-cols-3 gap-4">
          <Stat
            label="WER"
            value={
              <span className="inline-flex items-center gap-1.5">
                {formatPercent(scored.wer)}
                {wins ? <Check className="h-4 w-4 text-[var(--color-v2)]" /> : null}
              </span>
            }
            hint={ties ? "tie" : wins ? "better" : peerScore ? "worse" : undefined}
            tone={wins ? tone : scored.wer > 0.5 ? "bad" : undefined}
          />
          <Stat
            label="S / D / I"
            value={`${scored.substitutions}/${scored.deletions}/${scored.insertions}`}
            hint={`${scored.referenceWords} ref words`}
          />
          <Stat
            label="Insertions"
            value={formatPercent(scored.insertionRate)}
            hint="fabrication signal"
            tone={scored.insertionRate > 0.15 ? "bad" : undefined}
          />
        </div>
      ) : null}

      {scored?.hallucinated ? (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-[12px] text-[var(--color-bad)]">
          <AlertTriangle className="h-3.5 w-3.5" />
          Caption-scrape artifact detected — this output contains fabricated content.
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total" value={ms(result.latency.total_ms)} hint="server-side" tone={tone} />
        <Stat label="STT" value={ms(result.latency.stt_ms)} />
        <Stat label="Round trip" value={ms(result.latency.wall_ms)} hint="incl. upload" />
      </div>

      <LatencyBar latency={result.latency} />

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-[var(--color-muted)]">
        <span>windows {result.usage?.stt_windows ?? transcript?.windows ?? "—"}</span>
        <span>segments {transcript?.segments.length ?? 0}</span>
        <span>corrected {transcript?.corrected_segment_count ?? 0}</span>
        {result.usage?.stt_hedges_issued ? (
          <span>
            hedges {result.usage.stt_hedges_won}/{result.usage.stt_hedges_issued} won
          </span>
        ) : null}
        {result.embedding ? <span>embedding {result.embedding.dim}d</span> : null}
        <span className="font-mono">{result.request_id}</span>
      </div>

      {showEmbedding && result.embedding?.vector?.length ? (
        <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
          <div className="flex items-center gap-2">
            <Label>Speech embedding</Label>
            <Badge>{result.embedding.dim}d</Badge>
            <span className="ml-auto text-[11px] text-[var(--color-muted)]">
              {ms(result.latency.embedding_ms)}
            </span>
          </div>
          <EmbeddingVis
            vector={result.embedding.vector}
            tone={
              tone === "v2"
                ? "var(--color-v2)"
                : tone === "v3"
                  ? "var(--color-v3)"
                  : "var(--color-v1)"
            }
          />
          <VectorStats vector={result.embedding.vector} />
          <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            Produced by the same call as the transcript, from the audio itself — the embedding model
            is shared, so this vector does not change with the STT engine.
          </p>
        </div>
      ) : null}

      {transcript?.segments.length ? <Segments segments={transcript.segments} rtl={rtl} /> : null}
    </>
  );
}

function LatencyBar({ latency }: { latency: EngineResult["latency"] }) {
  const parts = [
    { key: "decode", value: latency.decode_ms ?? 0, color: "var(--color-muted)" },
    { key: "stt", value: latency.stt_ms ?? 0, color: "var(--color-v2)" },
    { key: "tagging", value: latency.tagging_ms ?? 0, color: "var(--color-v1)" },
    { key: "correction", value: latency.correction_ms ?? 0, color: "var(--color-warn)" },
    { key: "embedding", value: latency.embedding_ms ?? 0, color: "#a78bfa" },
  ].filter((part) => part.value > 0);
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;

  return (
    <div>
      <Label>Where the time went</Label>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-raised)]">
        {parts.map((part) => (
          <div
            key={part.key}
            title={`${part.key}: ${ms(part.value)}`}
            style={{ width: `${(part.value / total) * 100}%`, background: part.color }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
        {parts.map((part) => (
          <span key={part.key} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: part.color }} />
            {part.key} {ms(part.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Segments({
  segments,
  rtl,
}: {
  segments: NonNullable<EngineResult["transcript"]>["segments"];
  rtl: boolean;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.09em] text-[var(--color-muted)] hover:text-white">
        {segments.length} segments
      </summary>
      <div className="mt-2 space-y-1.5">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-raised)]/50 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <span className="font-mono">
                {segment.start.toFixed(2)}–{segment.end.toFixed(2)}s
              </span>
              {segment.primary ? <Badge>{languageName(segment.primary)}</Badge> : null}
              {segment.language_confidence != null ? (
                <span>conf {segment.language_confidence.toFixed(2)}</span>
              ) : null}
              {segment.language_source ? <span>{segment.language_source}</span> : null}
              {segment.corrected ? <Badge tone="warn">corrected</Badge> : null}
              {segment.avg_logprob != null ? (
                <span className="font-mono">logp {segment.avg_logprob.toFixed(3)}</span>
              ) : null}
            </div>
            <p className={cn("script-text mt-1", rtl && "rtl")}>{segment.text}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
