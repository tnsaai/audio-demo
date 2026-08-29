"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";

import { Badge, Button, Card, CardBody, CardHead, Label, Select, Stat } from "@/components/ui";
import {
  BENCHMARKS,
  CONDITIONS,
  DIARBENCH_LANGUAGES,
  ENGINES,
  PUBLISHED_RESULTS,
  type BenchmarkId,
  type ConditionId,
  type EngineKey,
} from "@/lib/engines";
import { languageName } from "@/lib/lang";
import { formatPercent } from "@/lib/wer";
import { cn, ms } from "@/lib/cn";

type EmbedRow = {
  type: "embedding";
  sample: string;
  language: string;
  condition: ConditionId;
  cosineVsClean: number;
  embeddingMs: number;
};

type Row = {
  type: "row";
  sample: string;
  language: string;
  source: string;
  condition: ConditionId;
  engine: EngineKey;
  wer: number;
  insertions: number;
  referenceWords: number;
  hallucinated: boolean;
  empty: boolean;
  latencyMs: number;
};

export default function Benchmark() {
  const [rows, setRows] = useState<Row[]>([]);
  const [embedRows, setEmbedRows] = useState<EmbedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [limit, setLimit] = useState(8);
  // DiarBench recordings are ~200 s each, so the default has to be far smaller.
  const [diarLimit, setDiarLimit] = useState(2);
  const [language, setLanguage] = useState("ar");
  const [benchmark, setBenchmark] = useState<BenchmarkId>("aren");
  const [diarLanguage, setDiarLanguage] = useState("Telugu");
  const abort = useRef<AbortController | null>(null);

  const start = async () => {
    setBusy(true);
    setRows([]);
    setEmbedRows([]);
    setErrors([]);
    setProgress({ done: 0, total: 0 });
    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmark,
          limit: benchmark === "diarbench" ? diarLimit : limit,
          diarLanguage,
          languages: language === "all" ? [] : [language],
          conditions: ["clean", "tel8k", "tel8k_noisy"],
          embeddings: benchmark === "aren",
        }),
        signal: controller.signal,
      });
      if (!response.body) throw new Error("no stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "start") setProgress({ done: 0, total: event.total });
          else if (event.type === "row") {
            setRows((current) => [...current, event as Row]);
            setProgress((current) => ({ ...current, done: current.done + 1 }));
          } else if (event.type === "embedding") {
            setEmbedRows((current) => [...current, event as EmbedRow]);
          } else if (event.type === "error") {
            setErrors((current) => [...current, `${event.sample} ${event.engine}: ${event.message}`]);
            setProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }
      }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setErrors((current) => [...current, (cause as Error).message]);
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const stop = () => {
    abort.current?.abort();
    setBusy(false);
  };

  /** Corpus WER — total errors over total reference words, not a mean of per-clip rates. */
  const summary = useMemo(() => {
    const buckets = new Map<string, { errors: number; words: number; hallu: number; clips: number; latency: number }>();
    for (const row of rows) {
      const key = `${row.condition}|${row.engine}`;
      const bucket = buckets.get(key) ?? { errors: 0, words: 0, hallu: 0, clips: 0, latency: 0 };
      bucket.errors += row.wer * row.referenceWords;
      bucket.words += row.referenceWords;
      bucket.hallu += row.hallucinated ? 1 : 0;
      bucket.clips += 1;
      bucket.latency += row.latencyMs;
      buckets.set(key, bucket);
    }
    return buckets;
  }, [rows]);

  const cell = (condition: ConditionId, engine: EngineKey) => {
    const bucket = summary.get(`${condition}|${engine}`);
    if (!bucket?.words) return null;
    return {
      wer: bucket.errors / bucket.words,
      clips: bucket.clips,
      hallu: bucket.hallu,
      latency: bucket.latency / bucket.clips,
    };
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight text-white">ARen benchmark</h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
          Every clip exists in three acoustic conditions, so what you measure is the degradation
          slope rather than a single number. Clean read speech barely separates the two engines —
          the gap only opens under telephony bandwidth and noise.
        </p>
      </header>

      <Card>
        <CardHead className="text-[14px] font-medium text-white">
          Published results — full set, 594 transcriptions
        </CardHead>
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.09em] text-[var(--color-muted)]">
                <th className="pb-2 font-medium">Language</th>
                <th className="pb-2 font-medium">Condition</th>
                <th className="pb-2 text-right font-medium">{ENGINES.v2.short} WER</th>
                <th className="pb-2 text-right font-medium">{ENGINES.v1indic.short} WER</th>
                <th className="pb-2 text-right font-medium">Delta</th>
              </tr>
            </thead>
            <tbody>
              {PUBLISHED_RESULTS.map((row) => (
                <tr key={`${row.lang}-${row.condition}`} className="border-t border-[var(--color-line)]">
                  <td className="py-2">{row.lang}</td>
                  <td className="py-2 text-[var(--color-muted)]">{row.condition}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--color-v2)]">
                    {row.v2.toFixed(1)}%
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--color-v1)]">
                    {row.v1indic.toFixed(1)}%
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-[var(--color-muted)]">
                    −{(row.v1indic - row.v2).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 max-w-3xl text-[12px] leading-relaxed text-[var(--color-muted)]">
            On Arabic the two engines differ by roughly 4 WER points on average, but by{" "}
            <strong className="text-[var(--color-body)]">9× in catastrophic-failure rate</strong> —
            clips above 50% WER, 1% versus 9%. Averages hid the difference that mattered.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHead className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label>Benchmark</Label>
            <div className="flex rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] p-1">
              {(Object.keys(BENCHMARKS) as BenchmarkId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => setBenchmark(id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40",
                    benchmark === id
                      ? "bg-[var(--color-surface)] font-medium text-white"
                      : "text-[var(--color-muted)] hover:text-white"
                  )}
                >
                  {BENCHMARKS[id].name}
                </button>
              ))}
            </div>
          </div>

          {benchmark === "aren" ? (
            <>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
                  <option value="ar">Arabic</option>
                  <option value="en">English</option>
                  <option value="all">Both</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Clips</Label>
                <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} disabled={busy}>
                  {[4, 8, 16, 32, 99].map((value) => (
                    <option key={value} value={value}>
                      {value} × 3 conditions × 2 engines
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select
                  value={diarLanguage}
                  onChange={(e) => setDiarLanguage(e.target.value)}
                  disabled={busy}
                >
                  {DIARBENCH_LANGUAGES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Recordings</Label>
                <Select
                  value={diarLimit}
                  onChange={(e) => setDiarLimit(Number(e.target.value))}
                  disabled={busy}
                >
                  {[1, 2, 5, 10, 25, 100].map((value) => (
                    <option key={value} value={value}>
                      {value} × 2 engines{value >= 10 ? "  (slow)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
          <Button
            variant={busy ? "default" : "primary"}
            onClick={busy ? stop : start}
            className="ml-auto"
          >
            {busy ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {busy ? "Stop" : "Run live"}
          </Button>
        </CardHead>

        <CardBody className="space-y-5">
          <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
            <a
              href={BENCHMARKS[benchmark].url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-body)] underline underline-offset-2"
            >
              {BENCHMARKS[benchmark].repo}
            </a>{" "}
            · {BENCHMARKS[benchmark].languages} — {BENCHMARKS[benchmark].detail}
          </p>

          {benchmark === "diarbench" ? (
            <div className="rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-4 py-3 text-[12px] leading-relaxed text-[var(--color-body)]">
              <strong className="text-[var(--color-warn)]">Read these numbers carefully.</strong>{" "}
              The reference is speaker-attributed and concatenated in time order, so WER here also
              charges both engines for speaker overlap and turn boundaries — neither engine
              attempts diarization. Scores run far higher than on ARen and are not comparable to it.
              Use this to compare the two engines against <em>each other</em> on Indic audio, not as
              an absolute accuracy figure. Recordings average ~200 s, so a large run is slow and
              will exceed a serverless function timeout.
            </div>
          ) : null}

          {progress.total ? (
            <div>
              <div className="flex items-center justify-between text-[12px] text-[var(--color-muted)]">
                <span className="inline-flex items-center gap-2">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {progress.done} / {progress.total} transcriptions
                </span>
                <span>{rows.length} scored</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-raised)]">
                <div
                  className="h-full bg-[var(--color-v2)] transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {rows.length && benchmark === "aren" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.09em] text-[var(--color-muted)]">
                    <th className="pb-2 font-medium">Condition</th>
                    <th className="pb-2 text-right font-medium">{ENGINES.v2.short} WER</th>
                    <th className="pb-2 text-right font-medium">{ENGINES.v1indic.short} WER</th>
                    <th className="pb-2 text-right font-medium">Delta</th>
                    <th className="pb-2 text-right font-medium">{ENGINES.v2.short} latency</th>
                    <th className="pb-2 text-right font-medium">{ENGINES.v1indic.short} latency</th>
                  </tr>
                </thead>
                <tbody>
                  {CONDITIONS.map((condition) => {
                    const a = cell(condition.id, "v2");
                    const b = cell(condition.id, "v1indic");
                    if (!a && !b) return null;
                    return (
                      <tr key={condition.id} className="border-t border-[var(--color-line)]">
                        <td className="py-2">
                          {condition.label}
                          <span className="ml-2 text-[11px] text-[var(--color-muted)]">
                            {a?.clips ?? 0} clips
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-[var(--color-v2)]">
                          {a ? formatPercent(a.wer) : "—"}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-[var(--color-v1)]">
                          {b ? formatPercent(b.wer) : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-2 text-right font-mono tabular-nums",
                            a && b && a.wer < b.wer ? "text-[var(--color-v2)]" : "text-[var(--color-muted)]"
                          )}
                        >
                          {a && b ? `${a.wer < b.wer ? "−" : "+"}${(Math.abs(b.wer - a.wer) * 100).toFixed(1)}` : "—"}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-[var(--color-muted)]">
                          {a ? ms(a.latency) : "—"}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-[var(--color-muted)]">
                          {b ? ms(b.latency) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {(() => {
                const clean = cell("clean", "v2");
                const noisy = cell("tel8k_noisy", "v2");
                const cleanV1 = cell("clean", "v1indic");
                const noisyV1 = cell("tel8k_noisy", "v1indic");
                if (!clean || !noisy || !cleanV1 || !noisyV1) return null;
                return (
                  <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
                    <Stat
                      label={`${ENGINES.v2.short} degradation`}
                      value={`+${((noisy.wer - clean.wer) * 100).toFixed(1)}`}
                      hint="WER points, clean → noisy"
                      tone="v2"
                    />
                    <Stat
                      label={`${ENGINES.v1indic.short} degradation`}
                      value={`+${((noisyV1.wer - cleanV1.wer) * 100).toFixed(1)}`}
                      hint="WER points, clean → noisy"
                      tone="v1"
                    />
                    <Stat
                      label="Hallucinated clips"
                      value={rows.filter((row) => row.hallucinated).length}
                      hint="caption-scrape artifacts"
                      tone={rows.some((row) => row.hallucinated) ? "bad" : undefined}
                    />
                    <Stat
                      label="Empty outputs"
                      value={rows.filter((row) => row.empty).length}
                      hint="silent failures"
                      tone={rows.some((row) => row.empty) ? "warn" : undefined}
                    />
                  </div>
                );
              })()}
            </div>
          ) : !busy ? (
            <p className="py-6 text-center text-[13px] text-[var(--color-muted)]">
              Run a live pass to fill in the degradation curve against the box.
            </p>
          ) : null}

          {errors.length ? (
            <div className="rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-4 py-3">
              <Label className="text-[var(--color-bad)]">{errors.length} failures</Label>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-[var(--color-body)]">
                {errors.slice(0, 6).map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHead className="flex items-center gap-2">
          <div className="text-[14px] font-medium text-white">Embedding robustness</div>
          <span className="ml-auto text-[11px] text-[var(--color-muted)]">
            cosine against the same utterance, clean
          </span>
        </CardHead>
        <CardBody>
          {embedRows.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-[var(--color-muted)]">
              Run a pass to measure how far the 1024-d vector moves as the channel degrades.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-5">
                {CONDITIONS.filter((condition) => condition.id !== "clean").map((condition) => {
                  const matching = embedRows.filter((row) => row.condition === condition.id);
                  if (!matching.length) return null;
                  const mean =
                    matching.reduce((sum, row) => sum + row.cosineVsClean, 0) / matching.length;
                  const worst = Math.min(...matching.map((row) => row.cosineVsClean));
                  return (
                    <Stat
                      key={condition.id}
                      label={condition.label}
                      value={mean.toFixed(3)}
                      hint={`${matching.length} clips · worst ${worst.toFixed(3)}`}
                      tone={mean > 0.9 ? "v2" : mean < 0.8 ? "warn" : undefined}
                    />
                  );
                })}
              </div>
              <p className="mt-4 max-w-3xl text-[12px] leading-relaxed text-[var(--color-muted)]">
                The embedding model is shared across both STT engines, so this measures the audio
                encoder rather than either transcriber. A conversation-level cache only works on
                phone audio if these stay above the hit threshold — the worst-case column matters
                more than the mean, since one clip falling through the floor is a cache miss.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead className="text-[14px] font-medium text-white">Per-clip results</CardHead>
        <CardBody className="max-h-96 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-[var(--color-muted)]">No rows yet.</p>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-[var(--color-muted)]">{row.sample}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={row.engine === "v2" ? "v2" : "v1"}>{ENGINES[row.engine].short}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-[var(--color-muted)]">
                      {CONDITIONS.find((c) => c.id === row.condition)?.label}
                    </td>
                    <td className="py-1.5 pr-3 text-[var(--color-muted)]">{languageName(row.language)}</td>
                    <td
                      className={cn(
                        "py-1.5 text-right font-mono tabular-nums",
                        row.wer > 0.5 ? "text-[var(--color-bad)]" : "text-[var(--color-body)]"
                      )}
                    >
                      {formatPercent(row.wer)}
                    </td>
                    <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-[var(--color-muted)]">
                      {ms(row.latencyMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
