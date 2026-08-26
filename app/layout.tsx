import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { HealthPill } from "@/components/health-pill";
import { UserMenu } from "@/components/user-menu";
import { SESSION_COOKIE, readSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "NGenSTT",
  description:
    "Transcription and audio embeddings for Indian and Arabic speech, run live against the TNSA GH200 instance.",
};

const NAV = [
  { href: "/", label: "Playground" },
  { href: "/compare", label: "Comparison" },
  { href: "/benchmark", label: "Benchmark" },
  { href: "/embeddings", label: "Embeddings" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const username = await readSession(store.get(SESSION_COOKIE)?.value);

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          {username ? (
            <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-ink)]/85 backdrop-blur">
              <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
                <Link href="/" className="text-[15px] font-semibold tracking-tight text-white">
                  NGenSTT
                </Link>
                <nav className="flex items-center gap-1">
                  {NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-white"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <div className="ml-auto flex items-center gap-3">
                  <HealthPill />
                  <UserMenu username={username} />
                </div>
              </div>
            </header>
          ) : null}
          <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
