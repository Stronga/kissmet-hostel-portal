export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function requiredString(input: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = input[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}
