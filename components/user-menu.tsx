"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function UserMenu({ username }: { username: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-[var(--color-muted)]">{username}</span>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        title="Sign out"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-white disabled:opacity-40"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
