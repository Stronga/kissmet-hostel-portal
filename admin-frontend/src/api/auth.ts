import { apiRequest } from "./client";
import type { AuthUser } from "../types/api";

export interface LoginResponse {
  token: string;
  expiresAt: string;
  mustChangePassword?: boolean;
  user: { id: number; name: string; role: AuthUser["role"]; mustChangePassword?: boolean };
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

/** Self-service password change. On success the backend revokes every other session of this user. */
export async function changePassword(currentPassword: string, newPassword: string) {
  return (await apiRequest<{ ok: true; data: { mustChangePassword: boolean; revokedOtherSessions: number } }>("/auth/staff/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  })).data;
}

export function logout() {
  return apiRequest<{ ok: true }>("/auth/logout", { method: "POST" });
}
