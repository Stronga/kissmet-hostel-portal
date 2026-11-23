import { resolveApiBaseUrl } from "../config/apiBaseUrl";

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.MODE);

import { GENDER_ERROR_MESSAGES } from "../utils/genderEligibility";

/** Friendly UI messages for stable backend domain error codes. */
const DOMAIN_ERROR_MESSAGES: Record<string, string> = { ...GENDER_ERROR_MESSAGES };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly details: unknown = null) {
    super(message);
  }
}

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: "include" });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : null;

  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    const errorBody = typeof payload === "object" && payload && "error" in payload ? (payload as { error: unknown }).error : null;
    const code = errorBody && typeof errorBody === "object" && typeof (errorBody as { code?: unknown }).code === "string" ? (errorBody as { code: string }).code : null;
    const serverMessage = typeof errorBody === "string"
      ? errorBody
      : errorBody && typeof errorBody === "object"
        ? ((errorBody as { message?: string }).message ?? "Request failed")
        : "Request failed";
    const message = (code && DOMAIN_ERROR_MESSAGES[code]) || serverMessage;
    const details = typeof payload === "object" && payload && "data" in payload ? (payload as { data: unknown }).data : null;
    throw new ApiError(message, response.status, code, details);
  }

  return payload as T;
}

export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const headers = new Headers();
  headers.set("Accept", "*/*");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { headers, credentials: "include" });
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    let message = "Download failed";
    try {
      const payload = JSON.parse(await response.text()) as { error?: string | { message?: string } };
      if (typeof payload.error === "string") message = payload.error;
      else if (payload.error && typeof payload.error === "object" && payload.error.message) message = payload.error.message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, response.status);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return {
    blob: await response.blob(),
    filename: match?.[1] || "document",
    contentType: response.headers.get("Content-Type") ?? "application/octet-stream"
  };
}
