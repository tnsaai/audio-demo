"use client";

import { diff, type DiffOp } from "@/lib/wer";
import { isRtl } from "@/lib/lang";
import { cn } from "@/lib/cn";
import { Badge, Card, CardBody, CardHead } from "./ui";

type Hypothesis = { engine: { short: string; name: string; key: "v2" | "v1" }; text: string };

/**
 * Word-level alignment against the reference.
 *
 * Reading two transcripts side by side in a script you may not know is hopeless;
 * colouring the edits is what makes the difference legible at a glance.
 */
export function DiffView({
  reference,
  language,
  hypotheses,
}: {
  reference: string;
  language: string | null;
  hypotheses: Hypothesis[];
}) {
  const rtl = isRtl(language);
  return (
    <Card>
      <CardHead className="flex flex-wrap items-center gap-3">
        <div className="text-[14px] font-medium text-white">Aligned against the reference</div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-muted)]">
          <Legend className="bg-[var(--color-bad)]/25 text-[var(--color-bad)]">substituted</Legend>
          <Legend className="bg-[var(--color-warn)]/25 text-[var(--color-warn)]">inserted</Legend>
          <Legend className="bg-[var(--color-muted)]/20 line-through">deleted</Legend>
        </div>
      </CardHead>
      <CardBody className="space-y-5">
        {hypotheses.map((hypothesis) => {
          const ops = diff(reference, hypothesis.text, language ?? undefined);
          return (
            <div key={hypothesis.engine.key}>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={hypothesis.engine.key}>{hypothesis.engine.short}</Badge>
                <span className="text-[12px] text-[var(--color-muted)]">{hypothesis.engine.name}</span>
              </div>
              <p
                className={cn(
                  "script-text rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-3",
                  rtl && "rtl"
                )}
              >
                {ops.map((op, index) => (
                  <Word key={index} op={op} />
                ))}
              </p>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function Word({ op }: { op: DiffOp }) {
  if (op.type === "equal") return <span>{op.hyp} </span>;
  if (op.type === "sub") {
    return (
      <span
        className="rounded bg-[var(--color-bad)]/25 px-1 text-[var(--color-bad)]"
        title={`reference: ${op.ref}`}
      >
        {op.hyp}{" "}
      </span>
    );
  }
  if (op.type === "ins") {
    return (
      <span className="rounded bg-[var(--color-warn)]/25 px-1 text-[var(--color-warn)]" title="not in reference">
        {op.hyp}{" "}
      </span>
    );
  }
  return (
    <span
      className="rounded bg-[var(--color-muted)]/20 px-1 text-[var(--color-muted)] line-through"
      title="missing from output"
    >
      {op.ref}{" "}
    </span>
  );
}

function Legend({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded px-1.5 py-0.5", className)}>{children}</span>;
}
