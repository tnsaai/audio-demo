import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { SESSION_COOKIE, authConfigured, readSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const store = await cookies();
  const username = await readSession(store.get(SESSION_COOKIE)?.value);
  if (username) redirect(next && next.startsWith("/") ? next : "/");

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="text-[19px] font-semibold tracking-tight text-white">NGenSTT</div>
          <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
            Transcription and speech embeddings for Indian and Arabic audio.
          </p>
        </div>
        <LoginForm next={next} configured={authConfigured()} />
      </div>
    </div>
  );
}
