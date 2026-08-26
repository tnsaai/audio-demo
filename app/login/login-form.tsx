"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, LogIn } from "lucide-react";

import { Button, Card, CardBody } from "@/components/ui";

export function LoginForm({ next, configured }: { next?: string; configured: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      // Refresh so the server layout picks up the new cookie for the header.
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <Card className="border-[var(--color-warn)]/40">
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-warn)]">
            <AlertTriangle className="h-4 w-4" />
            Sign-in is not configured
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--color-body)]">
            Set <code>DEMO_USER</code>, <code>DEMO_PASSWORD</code> and{" "}
            <code>SESSION_SECRET</code> in <code>.env.local</code>, then restart the server.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="username"
              className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--color-muted)]"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3 py-2 text-[13px] text-[var(--color-body)] outline-none focus:border-[var(--color-muted)]/60"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--color-muted)]"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3 py-2 text-[13px] text-[var(--color-body)] outline-none focus:border-[var(--color-muted)]/60"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-[12px] text-[var(--color-bad)]">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={busy || !username || !password}
            className="w-full"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
