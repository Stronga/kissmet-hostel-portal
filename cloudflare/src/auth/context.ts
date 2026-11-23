import type { RoleCode } from "./permissions";

export interface AuthUser {
  id: number;
  userType: "resident" | "staff" | "system";
  displayName: string;
  email: string | null;
  role: RoleCode;
  staffId: number | null;
  residentId: number | null;
  sessionId: number;
  /** Staff only: true until the account sets a new password (bootstrap / admin reset / admin-created). */
  mustChangePassword?: boolean;
}
