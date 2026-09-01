import { apiRequest } from "./client";
import type { AuthMeResponse } from "../types/api";

export function fetchMe() {
  return apiRequest<AuthMeResponse>("/auth/me");
}

export function logout() {
  return apiRequest<{ ok: true }>("/auth/logout", { method: "POST" });
}
