import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { AppRoutes } from "./AppRoutes";

const user = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const envelope = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });

function mockDashboardFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user }), { status: 200 });
    if (url.endsWith("/auth/logout")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.includes("/admin/dashboard/command-centre")) return envelope({ scope: { mode: "all", label: "All periods", academicSessionId: null, leasePeriodId: null }, actionable: { applicationsAwaitingReview: 2 }, summary: { totalResidents: 3, occupiedBeds: 1, availableBeds: 4, occupancyPercentage: 20 }, finance: { expectedBookingRevenue: 250000, verifiedPayments: 100000, outstandingBookingBalances: 150000, paymentsAwaitingVerificationCount: 0, paymentsAwaitingVerificationTotal: 0 }, periods: { academicSessions: [{ id: 1, name: "2026/2027" }], leasePeriods: [] } });
    if (url.includes("/admin/dashboard/occupancy/rooms")) return envelope({ rooms: [{ id: 1, roomCode: "A1", roomName: null, capacity: 2, genderPolicy: "female", status: "available", occupiedBeds: 1, beds: [] }] });
    if (url.includes("/admin/activity")) return new Response(JSON.stringify({ ok: true, data: [], pagination: { limit: 20, offset: 0, total: 0 }, unreadCount: 0 }), { status: 200 });
    if (url.includes("/admin/internet-access/connector-status")) return envelope({ configured: true, staleAfterSeconds: 180, connectors: [{ connectorId: "3f1c2b9e-8a7d-4c6b-9e5f-0a1b2c3d4e5f", lastSeenAt: "2026-11-22T12:00:00.000Z", ageSeconds: 15, stale: false, version: "0.1.0", hostname: null, connectorStatus: "ok", routerosStatus: "ok", uptimeSeconds: 42, heartbeatCount: 4, firstSeenAt: "2026-11-22T10:00:00.000Z" }] });
    return new Response(null, { status: 404 });
  });
}

describe("AppRoutes", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("redirects protected routes to login", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: /staff sign in/i })).toBeInTheDocument();
  });

  it("renders authenticated dashboard route", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    mockDashboardFetch();
    render(<MemoryRouter initialEntries={["/dashboard"]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("A1")).toBeInTheDocument();
  });

  it("logs out from authenticated shell", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    mockDashboardFetch();
    render(<MemoryRouter initialEntries={["/dashboard"]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    await waitFor(() => expect(localStorage.getItem("kissmet_admin_token")).toBeNull());
  });
});
