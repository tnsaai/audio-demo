"use client";

import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  base: string;
  gpu?: string;
  model_id?: string;
  dimension?: number;
  warmed?: boolean;
  error?: string;
};

/** Live badge for the inference box, so a dead endpoint is obvious mid-demo. */
export function HealthPill() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const payload = (await response.json()) as Health;
        if (!cancelled) setHealth(payload);
      } catch {
        if (!cancelled) setHealth({ ok: false, base: "", error: "unreachable" });
      }
    };
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!health) {
    return <span className="text-[12px] text-[var(--color-muted)]">checking instance…</span>;
  }

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
      title={health.ok ? `${health.base} · ${health.model_id ?? ""}` : health.error}
    >
      <span
        className={`h-2 w-2 rounded-full ${health.ok ? "bg-[var(--color-v2)]" : "bg-[var(--color-bad)]"}`}
        style={health.ok ? { boxShadow: "0 0 0 3px color-mix(in oklab, var(--color-v2) 25%, transparent)" } : undefined}
      />
      <span className="text-[12px] text-[var(--color-body)]">
        {health.ok ? health.gpu ?? "instance up" : "instance unreachable"}
      </span>
      {health.ok && health.warmed ? (
        <span className="text-[11px] text-[var(--color-muted)]">warm</span>
      ) : null}
    </div>
  );
}
