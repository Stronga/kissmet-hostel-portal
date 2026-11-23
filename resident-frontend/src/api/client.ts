import type { ApiErrorBody } from "../types/api";
import { resolveApiBaseUrl } from "../config/apiBaseUrl";

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.MODE);

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) {
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

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Request failed";
  const body = payload as ApiErrorBody;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && body.error.message) return body.error.message;
  if (typeof body.message === "string") return body.message;
  return "Request failed";
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : null;

  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    throw new ApiError(getErrorMessage(payload), response.status, payload);
  }

  return payload as T;
}

export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const headers = new Headers();
  headers.set("Accept", "*/*");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    let message = "Download failed";
    try {
      const payload = JSON.parse(await response.text()) as { error?: string | { message?: string }; message?: string };
      message = typeof payload.error === "string"
        ? payload.error
        : payload.error && typeof payload.error === "object" && payload.error.message
          ? payload.error.message
          : payload.message ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, response.status, undefined);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return {
    blob: await response.blob(),
    filename: match?.[1] || "document",
    contentType: response.headers.get("Content-Type") ?? "application/octet-stream"
  };
}
