const encoder = new TextEncoder();

/** Cloudflare Workers WebCrypto rejects PBKDF2 iterations above this value. */
export const PBKDF2_MAX_ITERATIONS = 100_000;

/** Default iterations for newly created password/OTP hashes (Workers-compatible). */
export const PBKDF2_ITERATIONS = 100_000;

export function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes.buffer);
}

/**
 * Unbiased decimal OTP via rejection sampling (avoids modulo bias from `byte % 10`).
 */
export function randomOtp(length = 6): string {
  const digits: string[] = [];
  while (digits.length < length) {
    const buf = new Uint8Array(length - digits.length);
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= 250) continue; // 250–255 would bias 0–5
      digits.push(String(byte % 10));
      if (digits.length === length) break;
    }
  }
  return digits.join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function derivePbkdf2Bits(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations },
    key,
    256
  );
  return bytesToHex(bits);
}

export async function hashPassword(password: string, salt = randomToken(16)): Promise<string> {
  const digest = await derivePbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt}$${digest}`;
}

/**
 * Verifies a stored `pbkdf2-sha256$<iterations>$<salt>$<hex>` hash.
 * Iteration count is read from the stored hash. Counts above
 * {@link PBKDF2_MAX_ITERATIONS} are rejected without calling WebCrypto
 * (Workers cannot derive them). Unsupported hashes are never treated as valid.
 */
export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false;

  const [algorithm, iterationsRaw, salt, hash] = storedHash.split("$");
  if (algorithm !== "pbkdf2-sha256" || !iterationsRaw || !salt || !hash) return false;

  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  // Workers WebCrypto: iteration counts above 100000 are not supported.
  if (iterations > PBKDF2_MAX_ITERATIONS) return false;

  const digest = await derivePbkdf2Bits(password, salt, iterations);
  return timingSafeEqualHex(digest, hash);
}
