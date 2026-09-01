import type { ApiErrorBody } from "../types/api";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

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
