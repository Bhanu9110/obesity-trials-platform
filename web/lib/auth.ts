// Site login: signed session cookie, no external service.
//
// Configure with environment variables:
//   AUTH_USERS   = "alice:Password1,bob:Password2"   (comma-separated user:password;
//                  passwords must not contain commas)
//   AUTH_SECRET  = a long random string used to sign the session cookie
//   AUTH_DISABLED= "true" to turn login off (local Docker only)
//
// Works in both the Edge runtime (middleware) and Node (route handlers): only
// Web Crypto is used.

export const SESSION_COOKIE = "otd_session";
export const SESSION_DAYS = 30;

// Guests (temporary view-only logins, Admin → Guest access) sign in as
// "guest:<name>". A colon can never appear in an AUTH_USERS name, so the prefix
// alone tells every part of the site that this is a guest.
export const GUEST_PREFIX = "guest:";
/** A guest session lasts this long and is renewed while they use the site (never past their end date). */
export const GUEST_SESSION_MIN = 60;

export const isGuest = (user: string | null | undefined): boolean => Boolean(user?.startsWith(GUEST_PREFIX));
export const guestName = (user: string): string => (isGuest(user) ? user.slice(GUEST_PREFIX.length) : user);

export function authDisabled(): boolean {
  return (process.env.AUTH_DISABLED ?? "").toLowerCase() === "true";
}

export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16 && parseUsers().size > 0);
}

function parseUsers(): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of (process.env.AUTH_USERS ?? "").split(",")) {
    const i = entry.indexOf(":");
    if (i <= 0) continue;
    const user = entry.slice(0, i).trim().toLowerCase();
    const pass = entry.slice(i + 1).trim();
    if (user && pass) m.set(user, pass);
  }
  return m;
}

/** Usernames allowed to sign in (from AUTH_USERS), never the passwords. */
export function configuredUsers(): string[] {
  return [...parseUsers().keys()].sort();
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Constant-time comparison of two strings (via HMAC of both). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await hmacKey();
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Returns the normalised username when the credentials are valid. */
export async function checkCredentials(username: string, password: string): Promise<string | null> {
  const user = (username ?? "").trim().toLowerCase();
  const expected = parseUsers().get(user);
  // Always run a comparison so timing does not reveal which usernames exist.
  const ok = await safeEqual(password ?? "", expected ?? "\u0000no-such-user");
  return ok && expected !== undefined ? user : null;
}

/** Signed session token. Guests get a short one that never outlives their access. */
export async function createSession(user: string, until?: number): Promise<string> {
  const exp = until ?? Date.now() + SESSION_DAYS * 86400000;
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** Username from a valid, unexpired session token (and the user still configured), else null. */
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  if (!token || !process.env.AUTH_SECRET) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), enc.encode(payload));
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u: string; exp: number };
    if (!data.u || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (isGuest(data.u)) return data.u; // still active? checked against the database (lib/guests.ts)
    return parseUsers().has(data.u) ? data.u : null; // removing a user from AUTH_USERS logs them out
  } catch {
    return null;
  }
}

// ---- Guest passwords: PBKDF2-SHA256 with a random salt (Web Crypto only). ----
const PBKDF2_ITERATIONS = 120_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [algo, iter, salt, hash] = (stored ?? "").split("$");
  if (algo !== "pbkdf2-sha256" || !iter || !salt || !hash) {
    await pbkdf2(password, fromB64url("AAAAAAAAAAAAAAAAAAAAAA"), PBKDF2_ITERATIONS); // same time either way
    return false;
  }
  const got = b64url(await pbkdf2(password, fromB64url(salt), Number(iter)));
  return safeEqual(got, hash);
}

/** A readable random password: no 0/O, 1/l/I. */
export function generatePassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
