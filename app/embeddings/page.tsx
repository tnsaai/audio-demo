"use client";

import { useState } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";

import { AudioSource, type Selection } from "@/components/audio-source";
import { EmbeddingVis, VectorStats, cosine } from "@/components/embedding-vis";
import { Badge, Button, Card, CardBody, CardHead, Empty, Label, Stat } from "@/components/ui";
import { CONDITIONS } from "@/lib/engines";
import { isRtl, languageName } from "@/lib/lang";
import { cn, ms } from "@/lib/cn";

type Item = {
  key: string;
  label: string;
  condition: string;
  language: string | null;
  vector: number[];
  dim: number;
  text: string;
  latencyMs: number;
  durationSec: number;
};

const PALETTE = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee"];

export default function Embeddings() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!selection) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.set("engines", "v2");
    form.set("language", "auto");
    if (selection.kind === "sample") {
      form.set("sample_id", selection.sample.id);
      form.set("condition", selection.condition);
    } else {
      form.set("audio", selection.blob, selection.filename);
    }

    try {
      const response = await fetch("/api/compare", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      const run = payload.runs?.[0];
      if (!run?.ok) throw new Error(run?.message ?? "engine failed");
      const embedding = run.result.embedding;
      if (!embedding?.vector?.length) throw new Error("no embedding returned");

      const label =
        selection.kind === "sample" ? selection.sample.label : selection.filename;
      const condition = selection.kind === "sample" ? selection.condition : "uploaded";
      setItems((current) => [
        ...current,
        {
          key: `${label}-${condition}-${Date.now()}`,
          label,
          condition,
          language: run.result.transcript?.language ?? null,
          vector: embedding.vector,
          dim: embedding.dim,
          text: run.result.transcript?.text ?? "",
          latencyMs: run.result.latency.embedding_ms ?? run.result.latency.total_ms,
          durationSec: run.result.duration,
        },
      ]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight text-white">Speech embeddings</h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
          A 1024-dimensional unit vector per clip, from the same single call that produces the
          transcript. Add several clips to see how the vectors relate — the same utterance under
          clean and telephony conditions should stay close, while different utterances separate.
        </p>
      </header>

      <AudioSource selection={selection} onSelect={setSelection} disabled={busy} />

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={add} disabled={!selection || busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? "Embedding…" : "Add to comparison"}
        </Button>
        {items.length ? (
          <Button variant="ghost" onClick={() => setItems([])}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear {items.length}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Card className="border-[var(--color-bad)]/40">
          <CardBody className="text-[13px] text-[var(--color-bad)]">{error}</CardBody>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Empty>Add a clip to see its vector.</Empty>
      ) : (
        <div className="space-y-5">
          {items.map((item, index) => (
            <Card key={item.key}>
              <CardHead className="flex flex-wrap items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: PALETTE[index % PALETTE.length] }}
                />
                <span className="font-mono text-[13px] text-white">{item.label}</span>
                <Badge>
                  {CONDITIONS.find((c) => c.id === item.condition)?.label ?? item.condition}
                </Badge>
                {item.language ? <Badge>{languageName(item.language)}</Badge> : null}
                <span className="ml-auto font-mono text-[11px] text-[var(--color-muted)]">
                  {item.dim}d · {ms(item.latencyMs)}
                </span>
              </CardHead>
              <CardBody className="space-y-4">
                <EmbeddingVis vector={item.vector} tone={PALETTE[index % PALETTE.length]} />
                <VectorStats vector={item.vector} />
                {item.text ? (
                  <p
                    className={cn(
                      "script-text border-t border-[var(--color-line)] pt-3 text-[var(--color-muted)]",
                      isRtl(item.language) && "rtl"
                    )}
                  >
                    {item.text}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ))}

          {items.length > 1 ? (
            <Card>
              <CardHead className="text-[14px] font-medium text-white">Cosine similarity</CardHead>
              <CardBody className="overflow-x-auto">
                <table className="text-[12px]">
                  <thead>
                    <tr>
                      <th />
                      {items.map((item, index) => (
                        <th key={item.key} className="px-2 pb-2 font-medium text-[var(--color-muted)]">
                          <span
                            className="mx-auto block h-2 w-2 rounded-full"
                            style={{ background: PALETTE[index % PALETTE.length] }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((rowItem, rowIndex) => (
                      <tr key={rowItem.key}>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-[var(--color-muted)]">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: PALETTE[rowIndex % PALETTE.length] }}
                            />
                            <span className="font-mono">{rowItem.label}</span>
                            <span className="text-[11px]">{rowItem.condition}</span>
                          </span>
                        </td>
                        {items.map((colItem) => {
                          const value = cosine(rowItem.vector, colItem.vector);
                          return (
                            <td
                              key={colItem.key}
                              className="px-2 py-1.5 text-center font-mono tabular-nums"
                              style={{
                                background: `color-mix(in oklab, var(--color-v2) ${Math.max(0, value) * 45}%, transparent)`,
                                color: value > 0.85 ? "#fff" : "var(--color-muted)",
                              }}
                            >
                              {value.toFixed(3)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-[var(--color-muted)]">
                  The same utterance across acoustic conditions should score high. A pair that stays
                  close under telephony degradation is what makes a conversation-level cache viable
                  on 8 kHz phone audio.
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
