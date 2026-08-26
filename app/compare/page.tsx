"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Play } from "lucide-react";

import { AudioSource, type Selection } from "@/components/audio-source";
import { EnginePanel, type Run } from "@/components/engine-panel";
import { DiffView } from "@/components/diff-view";
import { Badge, Button, Card, CardBody, CardHead, Label, Select } from "@/components/ui";
import { ENGINES, ENGINE_KEYS, type EngineKey } from "@/lib/engines";
import { LANGUAGE_GROUPS, isRtl, languageName } from "@/lib/lang";
import { score } from "@/lib/wer";
import { cn } from "@/lib/cn";

type CompareResponse = {
  reference: string | null;
  referenceLanguage: string | null;
  runs: Run[];
};

/**
 * Formal comparison — both engines on one clip, scored against a reference
 * where one exists, with a word-level diff and the cross-engine language check.
 */
export default function Compare() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [language, setLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!selection) return;
    setBusy(true);
    setError(null);
    setResponse(null);

    const form = new FormData();
    form.set("language", language);
    form.set("engines", ENGINE_KEYS.join(","));
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

  const runOf = (key: EngineKey) => response?.runs.find((item) => item.engine === key) ?? null;
  const v2 = runOf("v2");
  const v1 = runOf("v1");

  const reference = response?.reference ?? null;
  const referenceLanguage = response?.referenceLanguage ?? null;

  const languageOf = (item: Run | null) =>
    item?.ok ? item.result.transcript?.language ?? null : null;
  const v2Language = languageOf(v2);
  const v1Language = languageOf(v1);
  const disputed = Boolean(v2Language && v1Language && v2Language !== v1Language);

  const scores = useMemo(() => {
    if (!reference) return { v2: null, v1: null };
    const textOf = (item: Run | null) => (item?.ok ? item.result.transcript?.text ?? "" : null);
    const a = textOf(v2);
    const b = textOf(v1);
    return {
      v2: a == null ? null : score(reference, a, referenceLanguage ?? undefined),
      v1: b == null ? null : score(reference, b, referenceLanguage ?? undefined),
    };
  }, [reference, referenceLanguage, v2, v1]);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight text-white">Comparison</h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
          The same clip through both engines at once, scored against the reference where there is
          one, and aligned word by word. For an unscored look at a single model, use the playground.
        </p>
      </header>

      <AudioSource selection={selection} onSelect={setSelection} disabled={busy} />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
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

          <Button variant="primary" onClick={run} disabled={!selection || busy} className="ml-auto">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {busy ? "Running both engines…" : "Run comparison"}
          </Button>
        </CardBody>
      </Card>

      {error ? (
        <Card className="border-[var(--color-bad)]/40">
          <CardBody className="text-[13px] text-[var(--color-bad)]">{error}</CardBody>
        </Card>
      ) : null}

      {disputed ? (
        <Card className="border-[var(--color-bad)]/40 bg-[var(--color-bad)]/5">
          <CardBody className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-bad)]" />
            <div className="space-y-1">
              <div className="text-[13px] font-medium text-[var(--color-bad)]">
                The engines disagree on the spoken language
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--color-body)]">
                {ENGINES.v2.short} detected{" "}
                <strong>{languageName(v2Language)}</strong>, {ENGINES.v1.short} detected{" "}
                <strong>{languageName(v1Language)}</strong>. One of them is transliterating rather
                than transcribing — writing the speech phonetically into the wrong script, which
                reads as fluent text but means nothing. Force the spoken language above and re-run
                to find out which.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {reference ? (
        <Card>
          <CardHead className="flex items-center gap-2">
            <div className="text-[14px] font-medium text-white">Reference</div>
            <Badge>{languageName(referenceLanguage)}</Badge>
            <span className="ml-auto text-[11px] text-[var(--color-muted)]">
              ground truth from the ARen set
            </span>
          </CardHead>
          <CardBody>
            <p className={cn("script-text", isRtl(referenceLanguage) && "rtl")}>{reference}</p>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <EnginePanel
          engineKey="v2"
          run={v2}
          reference={reference}
          referenceLanguage={referenceLanguage}
          peerScore={scores.v1}
          disagreesWith={v1Language}
          busy={busy}
        />
        <EnginePanel
          engineKey="v1"
          run={v1}
          reference={reference}
          referenceLanguage={referenceLanguage}
          peerScore={scores.v2}
          disagreesWith={v2Language}
          busy={busy}
        />
      </div>

      {reference && v2?.ok && v1?.ok ? (
        <DiffView
          reference={reference}
          language={referenceLanguage}
          hypotheses={[
            { engine: ENGINES.v2, text: v2.result.transcript?.text ?? "" },
            { engine: ENGINES.v1, text: v1.result.transcript?.text ?? "" },
          ]}
        />
      ) : null}
    </div>
  );
}
