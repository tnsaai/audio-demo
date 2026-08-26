import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHead({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-[var(--color-line)] px-5 py-4", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function Label({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--color-muted)]",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "v2" | "v1" | "warn" | "bad" | "good";
}) {
  const tones: Record<string, string> = {
    neutral: "border-[var(--color-line)] text-[var(--color-muted)]",
    v2: "border-[var(--color-v2)]/40 text-[var(--color-v2)] bg-[var(--color-v2)]/10",
    v1: "border-[var(--color-v1)]/40 text-[var(--color-v1)] bg-[var(--color-v1)]/10",
    good: "border-[var(--color-v2)]/40 text-[var(--color-v2)] bg-[var(--color-v2)]/10",
    warn: "border-[var(--color-warn)]/40 text-[var(--color-warn)] bg-[var(--color-warn)]/10",
    bad: "border-[var(--color-bad)]/40 text-[var(--color-bad)] bg-[var(--color-bad)]/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

export function Button({
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  const variants: Record<string, string> = {
    default:
      "border border-[var(--color-line)] bg-[var(--color-raised)] text-[var(--color-body)] hover:border-[var(--color-muted)]/50",
    primary:
      "border border-transparent bg-white text-[var(--color-ink)] font-medium hover:bg-white/90",
    ghost: "border border-transparent text-[var(--color-muted)] hover:text-white hover:bg-[var(--color-raised)]",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3 py-2 text-[13px] text-[var(--color-body)] outline-none focus:border-[var(--color-muted)]/60",
        className
      )}
      {...props}
    />
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "v2" | "v1" | "bad" | "warn";
}) {
  const colors: Record<string, string> = {
    v2: "text-[var(--color-v2)]",
    v1: "text-[var(--color-v1)]",
    bad: "text-[var(--color-bad)]",
    warn: "text-[var(--color-warn)]",
  };
  return (
    <div>
      <Label>{label}</Label>
      <div className={cn("mt-1 font-mono text-[19px] tabular-nums text-white", tone && colors[tone])}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-line)] px-5 py-10 text-center text-[13px] text-[var(--color-muted)]">
      {children}
    </div>
  );
}
