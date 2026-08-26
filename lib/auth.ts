/**
 * Session auth for the demo.
 *
 * Deliberately small: one operator account from the environment, an HMAC-signed
 * cookie, no database. It uses Web Crypto rather than `node:crypto` so the same
 * code runs in middleware (edge runtime) and in route handlers.
 *
 * This is a gate on a demo, not an identity system. It does not do password
 * reset, lockout, or multiple users, and it should not grow into that — if this
 * ever needs real accounts, put it behind your existing SSO instead.
 */

export const SESSION_COOKIE = "ngenstt_session";
const TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

type Payload = { u: string; exp: number };

function toB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Backed by a freshly allocated ArrayBuffer rather than `Uint8Array.from`, so
 * the result is a `Uint8Array<ArrayBuffer>` and satisfies `BufferSource` —
 * `Uint8Array.from` widens to `ArrayBufferLike`, which Web Crypto rejects.
 */
function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function secret(): string | null {
  const value = process.env.SESSION_SECRET?.trim();
  return value ? value : null;
}

async function hmacKey(value: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSession(username: string): Promise<string> {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set");
  const payload: Payload = { u: username, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const body = toB64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(key), encoder.encode(body));
  return `${body}.${toB64Url(new Uint8Array(signature))}`;
}

/** Returns the username for a valid, unexpired token, or null. */
export async function readSession(token: string | undefined): Promise<string | null> {
  const key = secret();
  if (!key || !token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(key),
      fromB64Url(signature),
      encoder.encode(body)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(body))) as Payload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return typeof payload.u === "string" ? payload.u : null;
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison.
 *
 * `===` on a password leaks length and prefix through timing. The difference is
 * small over a network, but there is no reason to hand it away.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}

export function checkCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.DEMO_USER?.trim();
  const expectedPassword = process.env.DEMO_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;
  // Both comparisons always run, so a wrong username costs the same as a wrong password.
  const userOk = timingSafeEqual(username, expectedUser);
  const passwordOk = timingSafeEqual(password, expectedPassword);
  return userOk && passwordOk;
}

/** Whether the demo is configured well enough to let anyone in at all. */
export function authConfigured(): boolean {
  return Boolean(
    process.env.SESSION_SECRET?.trim() &&
      process.env.DEMO_USER?.trim() &&
      process.env.DEMO_PASSWORD
  );
}
