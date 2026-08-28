const encoder = new TextEncoder();

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

export function randomOtp(length = 6): string {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  return [...digits].map((digit) => String(digit % 10)).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function hashPassword(password: string, salt = randomToken(16)): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 210000 },
    key,
    256
  );

  return `pbkdf2-sha256$210000$${salt}$${bytesToHex(bits)}`;
}

export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false;

  const [algorithm, iterations, salt, hash] = storedHash.split("$");
  if (algorithm !== "pbkdf2-sha256" || iterations !== "210000" || !salt || !hash) return false;

  const candidate = await hashPassword(password, salt);
  return timingSafeEqualHex(candidate, storedHash);
}
