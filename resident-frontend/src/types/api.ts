export type UserType = "staff" | "resident" | "system";
export type RoleCode = "super_admin" | "manager" | "reception" | "accounts" | "maintenance" | "resident";

export interface AuthUser {
  id: number;
  userType: UserType;
  displayName: string;
  email: string | null;
  role: RoleCode;
  staffId: number | null;
  residentId: number | null;
  sessionId: number;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface ApiErrorBody {
  error?: string | { message?: string };
  message?: string;
}
