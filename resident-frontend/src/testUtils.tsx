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

export const residentProfile = {
  id: 3,
  resident_code: "KSM-RES-0003",
  first_name: "Ama",
  middle_name: null,
  last_name: "Resident",
  status: "applicant",
  phone_verified_at: "2026-08-28T03:37:35.599Z",
  phone: "+233555111222",
  email: "ama@example.com",
  institution_code: "UG",
  institution_name: "University of Ghana",
  student_id: "UG-123"
};

export function residentEndpointResponse(url: string) {
  if (url.endsWith("/resident/me/documents")) return Response.json({ ok: true, data: [] });
  if (url.endsWith("/resident/me/applications")) return Response.json({ ok: true, data: [] });
  if (url.endsWith("/resident/me/bookings")) return Response.json({ ok: true, data: [] });
  if (url.endsWith("/resident/me/payments/summary")) return Response.json({ ok: true, data: null });
  if (url.endsWith("/resident/me/payments")) return Response.json({ ok: true, data: [] });
  if (url.endsWith("/resident/me/receipts")) return Response.json({ ok: true, data: [] });
  if (url.endsWith("/resident/me/allocations")) return Response.json({ ok: true, data: [] });
  if (url.endsWith("/resident/me/allocation")) return Response.json({ ok: true, data: null });
  if (url.endsWith("/resident/me")) return Response.json({ ok: true, data: residentProfile });
  return null;
}

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
