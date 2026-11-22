import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { DashboardPage } from "./DashboardPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { ok: true, data } : { error: "Unable to load dashboard." }), { status });

function renderDashboard(withToken = false) {
  if (withToken) localStorage.setItem("kissmet_admin_token", "token");
  return render(<MemoryRouter><AuthProvider><DashboardPage /></AuthProvider></MemoryRouter>);
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

  it("renders successful dashboard response and the connector status card", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: manager }), { status: 200 });
      if (url.includes("/admin/internet-access/connector-status")) return envelope({
        configured: true,
        staleAfterSeconds: 180,
        connectors: [{ connectorId: "3f1c2b9e-8a7d-4c6b-9e5f-0a1b2c3d4e5f", lastSeenAt: "2026-11-22T12:00:00.000Z", ageSeconds: 15, stale: false, version: "0.1.0", hostname: "kissmet-pi", connectorStatus: "ok", routerosStatus: "ok", uptimeSeconds: 42, heartbeatCount: 4, firstSeenAt: "2026-11-22T10:00:00.000Z" }]
      });
      if (url.endsWith("/overview")) return envelope({ total_residents: 4, active_residents: 2, applicants: 2, occupied_beds: 1, available_beds: 3, occupancy_percentage: 25, pending_applications: 1, confirmed_bookings: 1, open_maintenance_requests: 1, urgent_maintenance_requests: 1, active_academic_session: "2026/2027" });
      if (url.endsWith("/occupancy")) return envelope({ total_usable_beds: 4, occupied_beds: 1, available_beds: 3, occupancy_percentage: 25, rooms: [] });
      if (url.endsWith("/finance")) return envelope({ expected_booking_revenue: 350000, verified_payments: 100000, outstanding_booking_balances: 250000 });
      if (url.endsWith("/applications")) return envelope({ submitted_applications: 1, under_review_applications: 1, approved_applications: 1, rejected_applications: 0, pending_bookings: 1, confirmed_bookings: 1 });
      if (url.endsWith("/maintenance")) return envelope({ open: 1, assigned: 0, in_progress: 0, resolved: 0, urgent: 1 });
      return envelope({});
    });
    renderDashboard(true);
    expect(await screen.findByText("GHS 3,500.00")).toBeInTheDocument();
    expect(await screen.findByText(/2026\/2027/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Connector status" })).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText(/kissmet-pi|https?:\/\//i)).not.toBeInTheDocument();
  });

  it("shows dashboard error state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope({}, 500));
    renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load dashboard.");
  });
});
