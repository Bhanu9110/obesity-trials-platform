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

// Logins managed on the Admin page (Users & access) sign in as "user:<name>"
// (members) or "guest:<name>" (guests). A colon can never appear in an
// AUTH_USERS name, so the prefix alone tells every part of the site which kind
// of login this is. AUTH_USERS accounts are the owners.
export const GUEST_PREFIX = "guest:";
export const MEMBER_PREFIX = "user:";
/** Session length for site users; renewed while they use the site (never past their end date). */
export const GUEST_SESSION_MIN = 60;
export const MEMBER_SESSION_MIN = 12 * 60;

export const isGuest = (user: string | null | undefined): boolean => Boolean(user?.startsWith(GUEST_PREFIX));
export const isSiteMember = (user: string | null | undefined): boolean => Boolean(user?.startsWith(MEMBER_PREFIX));
/** Managed on the Admin page (member or guest), as opposed to an owner in AUTH_USERS. */
export const isSiteUser = (user: string | null | undefined): boolean => isGuest(user) || isSiteMember(user);
/** The name without its "guest:" / "user:" prefix. */
export const plainName = (user: string): string => user.replace(/^(guest|user):/, "");
export const guestName = plainName;

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

/**
 * How a username is shown. Sign-in ignores capital letters, but owners appear
 * exactly as written in AUTH_USERS (e.g. "ObeyBhanu"); site logins without the
 * "user:" / "guest:" prefix.
 */
export function displayUsername(user: string): string {
  if (isSiteUser(user)) return plainName(user);
  for (const entry of (process.env.AUTH_USERS ?? "").split(",")) {
    const name = entry.slice(0, Math.max(0, entry.indexOf(":"))).trim();
    if (name && name.toLowerCase() === user.toLowerCase()) return name;
  }
  return user;
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

/**
 * Signed session token. Guests get a short one that never outlives their access,
 * carrying the pages they may open (checked by the middleware).
 */
export async function createSession(user: string, until?: number, pages?: string[]): Promise<string> {
  const exp = until ?? Date.now() + SESSION_DAYS * 86400000;
  const payload = b64url(enc.encode(JSON.stringify(pages ? { u: user, exp, p: pages } : { u: user, exp })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export interface Session {
  user: string;
  /** Guests only: pages they may open. */
  pages?: string[];
}

/** A valid, unexpired session (members must still be in AUTH_USERS), else null. */
export async function readSession(token: string | undefined | null): Promise<Session | null> {
  if (!token || !process.env.AUTH_SECRET) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), enc.encode(payload));
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u: string; exp: number; p?: unknown };
    if (!data.u || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (isGuest(data.u)) {
      // Still active? checked against the database (lib/site-users.ts).
      return { user: data.u, pages: Array.isArray(data.p) ? data.p.map(String) : [] };
    }
    if (isSiteMember(data.u)) return { user: data.u };
    return parseUsers().has(data.u) ? { user: data.u } : null; // removing a user from AUTH_USERS logs them out
  } catch {
    return null;
  }
}

/** Username from a valid session, else null. */
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  return (await readSession(token))?.user ?? null;
}

// ---- Site-user passwords: PBKDF2-SHA256 with a random salt (Web Crypto only). ----
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

// ---- Kept-for-the-admin password copy: AES-GCM, key derived from AUTH_SECRET. ----
async function aesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`otd-password-copy:${process.env.AUTH_SECRET ?? ""}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptText(text: string): Promise<string> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(text)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

/** null when there is no copy, or it can't be read (e.g. AUTH_SECRET was changed). */
export async function decryptText(stored: string | null | undefined): Promise<string | null> {
  const [v, iv, ct] = (stored ?? "").split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(), fromB64url(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
