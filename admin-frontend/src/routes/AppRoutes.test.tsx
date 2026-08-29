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
    if (url.endsWith("/admin/dashboard/overview")) return envelope({ total_residents: 3, active_residents: 2, applicants: 1, occupied_beds: 1, available_beds: 4, occupancy_percentage: 20, pending_applications: 2, confirmed_bookings: 1, open_maintenance_requests: 1, urgent_maintenance_requests: 0, active_academic_session: "2026/2027" });
    if (url.endsWith("/admin/dashboard/occupancy")) return envelope({ total_usable_beds: 5, occupied_beds: 1, available_beds: 4, occupancy_percentage: 20, rooms: [{ room_code: "A1", configured_capacity: 2, active_bed_count: 2, occupied_bed_count: 1, gender_policy: "female", room_status: "available", active_rate_minor: 250000 }] });
    if (url.endsWith("/admin/dashboard/finance")) return envelope({ expected_booking_revenue: 250000, verified_payments: 100000, outstanding_booking_balances: 150000, pending_submitted_payment_totals: 0, refunded_totals: 0, fully_paid_bookings: 0, partially_paid_bookings: 1, unpaid_bookings: 0, bookings_requiring_payment_attention: 0 });
    if (url.endsWith("/admin/dashboard/applications")) return envelope({ submitted_applications: 2, under_review_applications: 1, approved_applications: 1, rejected_applications: 0, pending_bookings: 1, confirmed_bookings: 1 });
    if (url.endsWith("/admin/dashboard/maintenance")) return envelope({ open: 1, assigned: 0, in_progress: 0, resolved: 0, urgent: 0 });
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
