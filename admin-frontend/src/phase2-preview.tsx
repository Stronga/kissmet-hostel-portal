import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { AppRoutes } from "./routes/AppRoutes";
import "./design-system/tokens.css";
import "./design-system/components.css";
import "./styles/index.css";

const manager = { id: 1, userType: "staff", displayName: "Fixture Manager", email: "fixture.manager@example.test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { ok: true, data } : data), { status, headers: { "Content-Type": "application/json" } });

const centre = {
  scope: { mode: "all", label: "All periods", academicSessionId: null, leasePeriodId: null },
  actionable: {
    applicationsAwaitingReview: 4,
    draftApplications: 1,
    applicationsRequiringAttention: 2,
    agreementsAwaitingPreparation: 1,
    paymentsAwaitingVerification: 2,
    refundsAwaitingApproval: 1,
    bookingsAwaitingAllocation: 1,
    urgentMaintenance: 1,
    internetProvisioningFailures: 1,
    operationalIssues: 1
  },
  summary: { totalResidents: 18, activeResidents: 6, applicants: 9, occupiedBeds: 7, availableBeds: 9, occupancyPercentage: 43.75 },
  finance: { expectedBookingRevenue: 180000, verifiedPayments: 90000, outstandingBookingBalances: 90000, paymentsAwaitingVerificationCount: 2, paymentsAwaitingVerificationTotal: 25000 },
  periods: {
    academicSessions: [{ id: 1, name: "Fixture session 2026/2027" }],
    leasePeriods: [{ id: 2, name: "Fixture short stay", kind: "short_term" }]
  }
};

const rooms = { rooms: [{
  id: 1, roomCode: "FA-01", roomName: "Fixture room", capacity: 2, genderPolicy: "any", status: "available", occupiedBeds: 1,
  beds: [
    { id: 1, bedCode: "FA-01-A", label: "A", status: "available", occupant: { allocationId: 4, residentCode: "KSM-RES-0104", name: "Fixture Resident" } },
    { id: 2, bedCode: "FA-01-B", label: "B", status: "available", occupant: null }
  ]
}] };

const activity = [{
  id: 9, category: "application", kind: "application_review", subjectType: "application", subjectId: 11,
  title: "Application KSM-APP-0101 awaiting review", detail: "Submitted", priority: "normal", status: "open",
  href: "/applications?queue=awaiting_review&record=11", unread: true, unresolved: true, unavailableReason: null, updatedAt: "2026-11-27T12:00:00.000Z"
}, {
  id: 10, category: "maintenance", kind: "maintenance_work", subjectType: "maintenance", subjectId: 3,
  title: "Urgent maintenance KSM-MNT-0103", detail: "Fixture leak", priority: "urgent", status: "open",
  href: "/maintenance?record=3", unread: false, unresolved: true, unavailableReason: null, updatedAt: "2026-11-27T11:00:00.000Z"
}];

const application = { id: 11, resident_id: 7, academic_session_id: 1, lease_period_id: null, lease_kind: "academic_calendar", application_number: "KSM-APP-0101", status: "submitted", submitted_at: "2026-11-20T10:00:00.000Z", created_at: "2026-11-19T09:15:00.000Z", updated_at: "2026-11-20T10:00:00.000Z", decision_notes: null };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0107", student_id: "FX-100", first_name: "Fixture", last_name: "Applicant", gender: "female", status: "applicant", resident_kind: "student" };
const workflow = {
  subjectType: "application", subjectId: 11, available: true, status: "submitted",
  steps: [
    { id: "draft", label: "Draft", state: "complete", detail: null },
    { id: "submitted", label: "Submitted", state: "current", detail: null },
    { id: "under_review", label: "Under review", state: "upcoming", detail: null },
    { id: "decision", label: "Decision", state: "upcoming", detail: null }
  ],
  nextAction: { label: "Start review", permission: "application:write", responsibleRole: "Reception or Manager", blockedReason: null },
  responsibleRole: "Reception or Manager",
  blockers: [],
  dependencies: ["corrections_required and withdrawn are Phase 4 statuses and are not shown here."]
};

localStorage.setItem("kissmet_admin_token", "phase2-preview-token");

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: manager }), { status: 200 });
  if (url.includes("/admin/dashboard/command-centre")) return json(centre);
  if (url.includes("/admin/dashboard/occupancy/rooms")) return json(rooms);
  if (url.includes("/admin/activity/unread-count")) return json({ unreadCount: 1 });
  if (url.includes("/admin/activity/") && init?.method === "POST") return json({ ...activity[0], unread: false });
  if (url.includes("/admin/activity")) return new Response(JSON.stringify({ ok: true, data: activity, pagination: { limit: 20, offset: 0, total: activity.length }, unreadCount: 1 }), { status: 200 });
  if (url.includes("/admin/internet-access/connector-status")) return json({ configured: true, staleAfterSeconds: 180, connectors: [] });
  if (url.includes("/admin/workflows/application/11")) return json(workflow);
  if (url.includes("/admin/applications?")) return json([application]);
  if (url.endsWith("/admin/applications/11")) return json(application);
  if (url.includes("/admin/institutions")) return json([{ id: 1, code: "FX", name: "Fixture Institution", status: "active" }]);
  if (url.includes("/admin/academic-sessions")) return json([{ id: 1, code: "FX", name: "Fixture session 2026/2027", status: "active" }]);
  if (url.endsWith("/admin/documents")) return json({ documents: [], restrictedResidentIds: [] });
  if (url.endsWith("/admin/residents/7")) return json(resident);
  if (url.includes("/admin/lease-periods")) return json([]);
  if (url.includes("/admin/rooms?")) return json([]);
  return json([]);
};

const route = window.location.hash.replace(/^#/, "") || "/dashboard";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  </StrictMode>
);
