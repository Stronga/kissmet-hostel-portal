export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request body");
  return value as Record<string, unknown>;
}

export function stringField(input: Record<string, unknown>, key: string, required = true, max = 255): string | null {
  const value = input[key];
  if (value == null && !required) return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new Error(`${key} is required`);
  if (trimmed.length > max) throw new Error(`${key} is too long`);
  return trimmed || null;
}

export function intField(input: Record<string, unknown>, key: string, required = true): number | null {
  const value = input[key];
  if (value == null && !required) return null;
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  return value as number;
}

export function pagination(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  return { limit, offset };
}
