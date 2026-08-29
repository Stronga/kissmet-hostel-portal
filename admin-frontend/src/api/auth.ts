import { apiRequest } from "./client";
import type { AuthUser } from "../types/api";

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: { id: number; name: string; role: AuthUser["role"] };
}

export function staffLogin(identifier: string, password: string) {
  return apiRequest<LoginResponse>("/auth/staff/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password })
  });
}

export function fetchMe() {
  return apiRequest<{ user: AuthUser }>("/auth/me");
}

export function logout() {
  return apiRequest<{ ok: true }>("/auth/logout", { method: "POST" });
}
