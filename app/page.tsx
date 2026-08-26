"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";

import { AudioSource, type Selection } from "@/components/audio-source";
import { EnginePanel, type Run } from "@/components/engine-panel";
import { Button, Card, CardBody, Label, Select } from "@/components/ui";
import { ENGINES, ENGINE_KEYS, type EngineKey } from "@/lib/engines";
import { LANGUAGE_GROUPS, languageName } from "@/lib/lang";
import { cn } from "@/lib/cn";

type CompareResponse = {
  reference: string | null;
  referenceLanguage: string | null;
  runs: Run[];
};

type ModelChoice = EngineKey | "both";

/**
 * Playground — the default surface.
 *
 * Not a scored comparison: you pick a clip, pick a model, and read the
 * transcript and the embedding it produced. Switching the model re-runs the
 * same audio, which is the fastest way to feel the difference between the two
 * engines without any benchmark ceremony. The formal scoring lives on /compare.
 */
export default function Playground() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [model, setModel] = useState<ModelChoice>("v2");
  const [language, setLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engines: EngineKey[] = model === "both" ? [...ENGINE_KEYS] : [model];

  const run = async (override?: ModelChoice) => {
    if (!selection) return;
    const choice = override ?? model;
    const wanted: EngineKey[] = choice === "both" ? [...ENGINE_KEYS] : [choice];

    setBusy(true);
    setError(null);
    setResponse(null);

    const form = new FormData();
    form.set("language", language);
    form.set("engines", wanted.join(","));
    if (targetLanguage) form.set("target_language", targetLanguage);
    if (selection.kind === "sample") {
      form.set("sample_id", selection.sample.id);
      form.set("condition", selection.condition);
    } else {
      form.set("audio", selection.blob, selection.filename);
    }

    try {
      const result = await fetch("/api/compare", { method: "POST", body: form });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload?.error ?? `HTTP ${result.status}`);
      setResponse(payload as CompareResponse);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchModel = (next: ModelChoice) => {
    setModel(next);
    // Re-run immediately when there is already a result on screen — the whole
    // point of the switcher is flipping models on the same audio.
    if (response && selection) void run(next);
  };

  const runOf = (key: EngineKey) => response?.runs.find((item) => item.engine === key) ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight text-white">Playground</h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
          Pick a clip, pick a model, read the transcript and the embedding it produced. Switching
          models re-runs the same audio. Built for Indian and Arabic speech, where the interesting
          failure is not a mishearing but speech emitted into the wrong script.
        </p>
      </header>

      <AudioSource selection={selection} onSelect={setSelection} disabled={busy} />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <div className="flex rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] p-1">
              {(["v2", "v1", "both"] as ModelChoice[]).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={busy}
                  onClick={() => switchModel(choice)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40",
                    model === choice
                      ? "bg-[var(--color-surface)] font-medium text-white"
                      : "text-[var(--color-muted)] hover:text-white"
                  )}
                >
                  {choice === "both" ? "Both" : ENGINES[choice].short}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Spoken language</Label>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
              <option value="auto">Auto detect</option>
              {LANGUAGE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.codes.map((code) => (
                    <option key={`${group.label}-${code}`} value={code}>
                      {languageName(code)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Force native script</Label>
            <Select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              disabled={busy}
            >
              <option value="">Leave as detected</option>
              {LANGUAGE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.codes.map((code) => (
                    <option key={`t-${group.label}-${code}`} value={code}>
                      {languageName(code)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>

          <Button
            variant="primary"
            onClick={() => run()}
            disabled={!selection || busy}
            className="ml-auto"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {busy ? "Running…" : "Transcribe"}
          </Button>
        </CardBody>
      </Card>

      {error ? (
        <Card className="border-[var(--color-bad)]/40">
          <CardBody className="text-[13px] text-[var(--color-bad)]">{error}</CardBody>
        </Card>
      ) : null}

      <div className={cn("grid gap-5", engines.length > 1 && "lg:grid-cols-2")}>
        {engines.map((engine) => (
          <EnginePanel
            key={engine}
            engineKey={engine}
            run={runOf(engine)}
            reference={response?.reference ?? null}
            referenceLanguage={response?.referenceLanguage ?? null}
            showEmbedding
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}
