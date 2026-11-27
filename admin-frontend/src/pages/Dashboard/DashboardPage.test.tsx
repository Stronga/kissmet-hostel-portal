import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { DashboardPage } from "./DashboardPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { ok: true, data } : { error: { message: "Unable to load dashboard." } }), { status });

const centre = {
  scope: { mode: "all", label: "All periods", academicSessionId: null, leasePeriodId: null },
  actionable: {
    applicationsAwaitingReview: 26,
    draftApplications: 3,
    applicationsRequiringAttention: 4,
    agreementsAwaitingPreparation: 2,
    paymentsAwaitingVerification: 5,
    refundsAwaitingApproval: 1,
    bookingsAwaitingAllocation: 6,
    urgentMaintenance: 1,
    internetProvisioningFailures: 2,
    operationalIssues: 1
  },
  summary: { totalResidents: 40, activeResidents: 8, applicants: 12, occupiedBeds: 9, availableBeds: 11, occupancyPercentage: 45 },
  finance: { expectedBookingRevenue: 350000, verifiedPayments: 100000, outstandingBookingBalances: 250000, paymentsAwaitingVerificationCount: 5, paymentsAwaitingVerificationTotal: 80000 },
  periods: { academicSessions: [{ id: 1, name: "2026/2027" }], leasePeriods: [{ id: 2, name: "Short stay" }] }
};

const rooms = { rooms: [{ id: 1, roomCode: "ROOM-A", roomName: "Fixture room", capacity: 2, genderPolicy: "any", status: "available", occupiedBeds: 1, beds: [
  { id: 1, bedCode: "ROOM-A-1", label: "A", status: "available", occupant: { allocationId: 1, residentCode: "KSM-RES-0001", name: "Ada Resident" } },
  { id: 2, bedCode: "ROOM-A-2", label: "B", status: "available", occupant: null }
] }] };

function renderDashboard(withToken = false, path = "/dashboard") {
  if (withToken) localStorage.setItem("kissmet_admin_token", "token");
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><DashboardPage /></AuthProvider></MemoryRouter>);
}

describe("DashboardPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows loading state", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    renderDashboard();
    expect(screen.getByText("Loading dashboard...")).toBeInTheDocument();
  });

  it("renders the command centre, activity panel, and occupancy table", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: manager }), { status: 200 });
      if (url.includes("/admin/internet-access/connector-status")) return envelope({ configured: true, staleAfterSeconds: 180, connectors: [] });
      if (url.includes("/admin/dashboard/command-centre")) return envelope(centre);
      if (url.includes("/admin/dashboard/occupancy/rooms")) return envelope(rooms);
      if (url.includes("/admin/activity?")) return new Response(JSON.stringify({ ok: true, data: [{ id: 9, category: "application", kind: "application_review", subjectType: "application", subjectId: 11, title: "Application KSM-APP-0011 awaiting review", detail: "Submitted", priority: "normal", status: "open", href: "/applications?queue=awaiting_review&record=11", unread: true, unresolved: true, unavailableReason: null, updatedAt: null }], pagination: { limit: 20, offset: 0, total: 1 }, unreadCount: 1 }), { status: 200 });
      return envelope({});
    });
    renderDashboard(true);
    expect(await screen.findByTestId("scope-label")).toHaveTextContent("All periods");
    expect(document.querySelector(".km-command--open")).toBeTruthy();
    expect(screen.getByText("Applications awaiting review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Applications awaiting review/i })).toHaveAttribute("href", "/applications?queue=awaiting_review");
    expect(screen.getByText("26")).toBeInTheDocument();
    expect(screen.getByText("Draft applications")).toBeInTheDocument();
    expect(screen.getByText("GHS 3,500.00")).toBeInTheDocument();
    expect(screen.getByTestId("activity-centre")).toBeInTheDocument();
    expect(await screen.findByText("Application KSM-APP-0011 awaiting review")).toBeInTheDocument();
    expect(screen.getByText("ROOM-A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText(/Ada Resident/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByTestId("activity-centre")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show activity" })).toHaveAttribute("aria-expanded", "false");
  });

  it("starts with the activity centre collapsed when the URL says so", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: manager }), { status: 200 });
      if (url.includes("/admin/internet-access/connector-status")) return envelope({ configured: false, connectors: [] });
      if (url.includes("/admin/dashboard/command-centre")) return envelope({ ...centre, finance: null, actionable: { urgentMaintenance: 0 } });
      if (url.includes("/admin/dashboard/occupancy/rooms")) return envelope({ rooms: [] });
      return envelope({});
    });
    renderDashboard(true, "/dashboard?activity=closed");
    expect(await screen.findByTestId("scope-label")).toHaveTextContent("All periods");
    expect(document.querySelector(".km-command--open")).toBeNull();
    expect(screen.queryByTestId("activity-centre")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show activity" })).toBeInTheDocument();
  });

  it("shows dashboard error state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope({}, 500));
    renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load dashboard.");
  });
});
