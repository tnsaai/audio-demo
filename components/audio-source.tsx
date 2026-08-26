"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { CONDITIONS, type ConditionId } from "@/lib/engines";
import { languageName } from "@/lib/lang";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardBody, CardHead, Label, Select } from "./ui";
import { WaveformPlayer, WaveformRecorder } from "./waveform";

export type Sample = {
  id: string;
  origin: "aren" | "custom";
  label: string;
  language: string | null;
  source: string;
  duration: number | null;
  reference: string | null;
  conditions: ConditionId[];
  baseline: Partial<Record<ConditionId, { v2: string | null; v1: string | null }>>;
};

export type Selection =
  | { kind: "sample"; sample: Sample; condition: ConditionId }
  | { kind: "blob"; blob: Blob; filename: string; url: string };

type Props = {
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  disabled?: boolean;
};

export function AudioSource({ selection, onSelect, disabled }: Props) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [customDir, setCustomDir] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [condition, setCondition] = useState<ConditionId>("clean");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/samples");
        const payload = (await response.json()) as { samples: Sample[]; customDir: string | null };
        setSamples(payload.samples ?? []);
        setCustomDir(payload.customDir);
      } catch {
        setSamples([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const sample of samples) if (sample.language) set.add(sample.language);
    return [...set].sort();
  }, [samples]);

  const visible = useMemo(
    () => (languageFilter === "all" ? samples : samples.filter((s) => s.language === languageFilter)),
    [samples, languageFilter]
  );

  return (
    <Card>
      <CardHead className="flex flex-wrap items-center gap-3">
        <div className="text-[14px] font-medium text-white">Audio</div>
        <div className="ml-auto">
          <UploadButton disabled={disabled} onDone={onSelect} />
        </div>
      </CardHead>

      <CardBody className="space-y-4">
        <WaveformRecorder
          disabled={disabled}
          onDone={(blob, filename, url) => onSelect({ kind: "blob", blob, filename, url })}
        />

        {selection?.kind === "blob" ? (
          <div className="space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-3">
            <div className="flex items-center gap-3">
              <Badge tone="good">your audio</Badge>
              <span className="truncate text-[13px]">{selection.filename}</span>
              <Button
                variant="ghost"
                onClick={() => onSelect(null)}
                disabled={disabled}
                className="ml-auto"
              >
                clear
              </Button>
            </div>
            <WaveformPlayer url={selection.url} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label>Language</Label>
            <Select
              value={languageFilter}
              onChange={(event) => setLanguageFilter(event.target.value)}
              disabled={disabled}
            >
              <option value="all">All ({samples.length})</option>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label>Condition</Label>
            <Select
              value={condition}
              onChange={(event) => {
                const next = event.target.value as ConditionId;
                setCondition(next);
                if (selection?.kind === "sample") {
                  onSelect({ ...selection, condition: next });
                }
              }}
              disabled={disabled}
            >
              {CONDITIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>

          <p className="text-[12px] text-[var(--color-muted)]">
            {CONDITIONS.find((item) => item.id === condition)?.detail}
          </p>
        </div>

        {!loaded ? (
          <div className="py-6 text-center text-[13px] text-[var(--color-muted)]">loading sample bank…</div>
        ) : samples.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-6 text-[13px] text-[var(--color-muted)]">
            No sample bank configured. Set <code className="text-[var(--color-body)]">AREN_DIR</code> in{" "}
            <code className="text-[var(--color-body)]">.env.local</code> for the Arabic/English set, and{" "}
            <code className="text-[var(--color-body)]">CUSTOM_AUDIO_DIR</code> for your own clips. Upload
            and record work regardless.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--color-line)]">
            {visible.map((sample) => {
              const available = sample.conditions.includes(condition);
              const active = selection?.kind === "sample" && selection.sample.id === sample.id;
              return (
                <button
                  key={sample.id}
                  type="button"
                  disabled={disabled || !available}
                  onClick={() => onSelect({ kind: "sample", sample, condition })}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 text-left last:border-b-0 transition-colors",
                    active ? "bg-[var(--color-raised)]" : "hover:bg-[var(--color-raised)]/60",
                    !available && "cursor-not-allowed opacity-35"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      active ? "bg-[var(--color-v2)]" : "bg-[var(--color-line)]"
                    )}
                  />
                  <Badge tone={sample.language === "ar" ? "warn" : "neutral"}>
                    {languageName(sample.language)}
                  </Badge>
                  <span className="truncate font-mono text-[12px] text-[var(--color-body)]">
                    {sample.label}
                  </span>
                  {sample.reference ? (
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12px] text-[var(--color-muted)]",
                        sample.language === "ar" && "rtl"
                      )}
                    >
                      {sample.reference}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {sample.duration ? (
                    <span className="shrink-0 font-mono text-[11px] text-[var(--color-muted)]">
                      {sample.duration.toFixed(1)}s
                    </span>
                  ) : null}
                </button>
              );
            })}
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-[var(--color-muted)]">
                No clips for that language.
              </div>
            ) : null}
          </div>
        )}

        {selection?.kind === "sample" ? (
          <div className="space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[12px]">{selection.sample.label}</span>
              <Badge>{CONDITIONS.find((c) => c.id === selection.condition)?.label}</Badge>
            </div>
            <WaveformPlayer
              key={`${selection.sample.id}-${selection.condition}`}
              url={`/api/audio?id=${encodeURIComponent(selection.sample.id)}&condition=${selection.condition}`}
            />
          </div>
        ) : null}

        {customDir ? (
          <p className="text-[11px] text-[var(--color-muted)]">
            Drop-in folder: <code>{customDir}</code> — prefix a filename with a language code
            (<code>hi_</code>, <code>ta-</code>) to tag it.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function UploadButton({
  onDone,
  disabled,
}: {
  onDone: (selection: Selection) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          onDone({
            kind: "blob",
            blob: file,
            filename: file.name,
            url: URL.createObjectURL(file),
          });
          event.target.value = "";
        }}
      />
      <Button disabled={disabled} onClick={() => input.current?.click()}>
        <Upload className="h-3.5 w-3.5" />
        Upload
      </Button>
    </>
  );
}
