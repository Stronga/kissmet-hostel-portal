import { MemoryRouter } from "react-router-dom";
import { AuthProvider, RESIDENT_TOKEN_KEY } from "./auth/AuthContext";
import { AppRoutes } from "./routes/AppRoutes";
import type { AuthUser } from "./types/api";

export const residentUser: AuthUser = {
  id: 10,
  userType: "resident",
  displayName: "Ama Resident",
  email: "ama@example.com",
  role: "resident",
  staffId: null,
  residentId: 3,
  sessionId: 99
};

export const staffUser: AuthUser = {
  id: 1,
  userType: "staff",
  displayName: "Admin User",
  email: "admin@kissmetgroup.org",
  role: "super_admin",
  staffId: 1,
  residentId: null,
  sessionId: 8
};

export function renderResidentApp(initialEntries = ["/"]) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  );
}

export function seedResidentToken(token = "resident-token") {
  localStorage.setItem(RESIDENT_TOKEN_KEY, token);
}
