const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
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

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : null;

  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    const message = typeof payload === "object" && payload && "error" in payload
      ? typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : ((payload as { error: { message?: string } }).error.message ?? "Request failed")
      : "Request failed";
    throw new ApiError(message, response.status);
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
