import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { ReportsPage } from "./ReportsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { ok: true, data } : { error: { message: "Unable to load reports." } }), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, pagination: { limit: 100, offset: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function mockReports(role: "manager" | "reception" = "manager", fail = false) {
  localStorage.setItem("kissmet_admin_token", "token");
  const createObjectURL = vi.fn(() => "blob:report");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "manager" ? manager : reception }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/admin/academic-sessions?limit=100&offset=0")) return list([{ id: 1, name: "2026/2027", code: "2026", status: "active" }]);
    if (fail && url.includes("/admin/reports/overview")) return json(null, 500);
    if (url.includes("/admin/reports/overview")) return json({ scope: { academicSession: "all_sessions" }, overview: { total_residents: 3, applicants: 1 }, occupancy: { total_usable_beds: 3, occupied_beds: 2, available_beds: 1, occupancy_percentage: 66.67 }, applicationsBookings: { pending_bookings: 1, confirmed_bookings: 1 }, maintenance: { open: 1 } });
    if (url.includes("/admin/reports/occupancy")) return json({ total_usable_beds: 3, occupied_beds: 2, available_beds: 1, occupancy_percentage: 66.67, rooms: [{ room_code: "R1", configured_capacity: 4, active_bed_count: 3, occupied_bed_count: 2, gender_policy: "female", room_status: "available", active_rate_minor: 250000 }] });
    if (url.includes("/admin/reports/residents")) return json({ statusCounts: [{ status: "resident", count: 2 }, { status: "applicant", count: 1 }], residents: [{ id: 7, resident_code: "KSM-RES-0007", first_name: "Ama", last_name: "Mensah", student_id: "UG-100", institution_name: "University of Ghana", status: "resident", room_code: "R1", bed_label: "A", assigned_date: "2026-08-28T03:37:35.599Z" }] });
    if (url.includes("/admin/reports/applications-bookings")) return json({ summary: { draft_applications: 1, submitted_applications: 2, under_review_applications: 1, approved_applications: 3, rejected_applications: 1, pending_bookings: 1, confirmed_bookings: 1 }, bookings: [{ id: 1, booking_number: "KSM-BKG-0001", status: "pending", total_amount_minor: 250000, currency: "GHS", payment_attention_required: 1, academic_session_name: "2026/2027", resident_code: "KSM-RES-0007", first_name: "Ama", last_name: "Mensah", priced_room_code: "R1", verified_amount_minor: 100000, outstanding_amount_minor: 150000 }] });
    if (url.includes("/admin/reports/finance")) return json({ summary: { expected_booking_revenue: 250000, verified_payments: 100000, outstanding_booking_balances: 150000, pending_submitted_payment_totals: 50000, refunded_totals: 25000, fully_paid_bookings: 1, bookings_requiring_payment_attention: 1 }, paymentMethods: [{ method: "mobile_money", count: 1, verified_amount_minor: 100000 }], outstanding: { totalOutstandingMinor: 150000, balances: [{ id: 1, booking_number: "KSM-BKG-0001", status: "pending", total_amount_minor: 250000, currency: "GHS", payment_attention_required: 1, resident_code: "KSM-RES-0007", first_name: "Ama", last_name: "Mensah", verified_amount_minor: 100000, outstanding_amount_minor: 150000 }] } });
    if (url.includes("/admin/reports/maintenance")) return json({ summary: { open: 1, assigned: 1, in_progress: 0, resolved: 2, closed: 1, cancelled: 0 }, byCategory: [{ category: "plumbing", count: 2 }], byPriority: [{ priority: "urgent", count: 1 }] });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><ReportsPage /></AuthProvider></MemoryRouter>);
}

describe("ReportsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders overview and occupancy reports using bed and allocation metrics", async () => {
    mockReports();
    expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(await screen.findByText("66.67%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Occupancy" }));
    expect(await screen.findByText("Occupancy by Room")).toBeInTheDocument();
    expect(screen.getByText("R1")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("renders resident application booking finance and maintenance sections", async () => {
    mockReports();
    await userEvent.click(await screen.findByRole("button", { name: "Residents" }));
    expect(await screen.findByText("KSM-RES-0007")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Applications & Bookings" }));
    expect(await screen.findByText("KSM-BKG-0001")).toBeInTheDocument();
    expect(screen.getByText("GHS 2,500.00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Finance" }));
    expect(await screen.findByText("Verified Revenue by Payment Method")).toBeInTheDocument();
    expect(screen.getAllByText("GHS 1,000.00").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Maintenance" }));
    expect(await screen.findByText("Maintenance by Category")).toBeInTheDocument();
    expect(screen.getByText("Plumbing")).toBeInTheDocument();
  });

  it("applies academic session and date filters to report requests", async () => {
    mockReports();
    await screen.findByRole("heading", { name: "Reports" });
    await screen.findByText("66.67%");
    await userEvent.selectOptions(screen.getByLabelText("Academic Session"), "1");
    await userEvent.type(screen.getByLabelText("Date From"), "2026-08-01");
    await userEvent.type(screen.getByLabelText("Date To"), "2026-08-31");
    await userEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("academicSessionId=1") && String(url).includes("dateFrom=2026-08-01"))).toBe(true);
    });
  });

  it("exports visible table data as CSV", async () => {
    mockReports();
    await userEvent.click(await screen.findByRole("button", { name: "Occupancy" }));
    await screen.findByText("Occupancy by Room");
    await userEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("hides financial report tabs without finance permission and shows API errors", async () => {
    mockReports("reception");
    expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finance" })).not.toBeInTheDocument();
    vi.restoreAllMocks();
    cleanup();
    mockReports("manager", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load reports.");
  });
});
