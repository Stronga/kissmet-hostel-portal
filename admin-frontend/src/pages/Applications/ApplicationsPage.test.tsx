import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { ApplicationsPage } from "./ApplicationsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts = { ...manager, role: "accounts" };
const institution = { id: 1, code: "ug", name: "University of Ghana", status: "active" };
const session = { id: 1, code: "2026", name: "2026/2027", status: "active" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "applicant" , resident_kind: "student" };
const submittedApplication = { id: 11, resident_id: 7, academic_session_id: 1, lease_period_id: null, lease_kind: "academic_calendar", application_number: "KSM-APP-0011", status: "submitted", submitted_at: "2026-08-20T10:00:00.000Z", created_at: "2026-08-19T09:15:00.000Z", updated_at: "2026-08-20T10:00:00.000Z", decision_notes: null };
const reviewApplication = { ...submittedApplication, id: 12, application_number: "KSM-APP-0012", status: "under_review" };
const approvedApplication = { ...submittedApplication, id: 13, application_number: "KSM-APP-0013", status: "approved", lease_kind: "short_term", lease_period_id: 3, academic_session_id: null };
const documentRow = { id: 30, resident_id: 7, document_type: "student_card", status: "uploaded", original_filename: "student-card.pdf", content_type: "application/pdf", size_bytes: 1200 };
const leasePeriods = [
  { id: 1, kind: "academic_calendar", code: "AC", name: "Academic 2026/27", starts_on: "2026-09-01", ends_on: "2027-06-30", status: "active", academic_session_id: 1, notes: null },
  { id: 2, kind: "calendar_year", code: "CY", name: "Calendar Year 2027", starts_on: "2027-01-01", ends_on: "2027-12-31", status: "active", academic_session_id: null, notes: null },
  { id: 3, kind: "short_term", code: "ST", name: "Short-Term Jan–Mar 2027", starts_on: "2027-01-01", ends_on: "2027-03-31", status: "active", academic_session_id: null, notes: null }
];
const rooms = [
  { id: 1, room_code: "DAISY", room_name: "Daisy", capacity: 2, gender_policy: "female", status: "available" }
];
const rateCard = { id: 9, lease_period_id: 3, occupancy_capacity: 2, rate_code: "ST-2P", amount_minor: 350000, currency: "GHS", package_months: 3, status: "active", effective_from: null, effective_to: null, notes: null };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function envelope(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 25, offset: 0 } });
}

function renderWithFetch(options: { role?: "manager" | "accounts"; applications?: unknown[]; failPatch?: boolean } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  const apps = options.applications ?? [submittedApplication];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "accounts" ? accounts : manager });
    if (url.includes("/admin/applications?")) return envelope(apps);
    if (url.includes("/admin/institutions")) return envelope([institution]);
    if (url.includes("/admin/academic-sessions")) return envelope([session]);
    if (url.endsWith("/admin/documents")) return json({ ok: true, data: { documents: [documentRow], restrictedResidentIds: [] } });
    if (url.endsWith("/admin/residents/7")) return json({ ok: true, data: resident });
    if (url.endsWith("/admin/applications/11")) return json({ ok: true, data: submittedApplication });
    if (url.endsWith("/admin/applications/12")) return json({ ok: true, data: reviewApplication });
    if (url.endsWith("/admin/applications/13")) return json({ ok: true, data: approvedApplication });
    if (url.endsWith("/admin/applications/11/status") && init?.method === "PATCH") {
      if (options.failPatch) return json({ error: { message: "Invalid workflow transition" } }, 400);
      return json({ ok: true, data: { ...submittedApplication, status: "under_review", reviewed_at: "2026-08-21T10:00:00.000Z" } });
    }
    if (url.endsWith("/admin/applications/12/status") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { status: string; notes?: string };
      return json({ ok: true, data: { ...reviewApplication, status: body.status, decision_notes: body.notes ?? null } });
    }
    if (url.includes("/admin/lease-periods")) return envelope(leasePeriods);
    if (url.includes("/admin/rooms?")) return envelope(rooms);
    if (url.includes("/admin/rate-cards/resolve")) return json({ ok: true, data: rateCard });
    if (url.endsWith("/admin/bookings/from-rate-card") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({
        ok: true,
        data: {
          booking: { id: 50, booking_number: "KSM-BKG-0050", status: "pending", total_amount_minor: body.agreedAmountMinor ?? 350000, currency: "GHS", lease_kind: "short_term", lease_period_id: body.leasePeriodId, academic_session_id: null, priced_room_id: body.roomId, application_id: body.applicationId, resident_id: 7 },
          agreement: { pricing_path: "lease_rate_card", lease_kind: "short_term", academic_session_id: null },
          financial: { agreed_accommodation_amount_minor: 350000, maintenance_fee_minor: body.maintenanceFeeMinor ?? 0, total_obligation_minor: 350000, verified_paid_minor: 0, balance_minor: 350000, currency: "GHS" },
          request: { application_id: 13, requested_lease_kind: "short_term", requested_lease_period_id: 3 }
        }
      }, 201);
    }
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><ApplicationsPage /></AuthProvider></MemoryRouter>);
}

async function openOnlyViewButton() {
  await userEvent.click(await screen.findByRole("button", { name: "View" }));
  return screen.findByText("Application Details");
}

describe("ApplicationsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads applications and renders supported API fields", async () => {
    renderWithFetch();
    expect(await screen.findByRole("heading", { name: "Applications" })).toBeInTheDocument();
    expect(await screen.findByText("KSM-APP-0011")).toBeInTheDocument();
    expect(screen.getByText("Academic Calendar")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getByText("UG-100")).toBeInTheDocument();
    expect(screen.getByText("University of Ghana")).toBeInTheDocument();
    expect(screen.getAllByText("2026/2027").length).toBeGreaterThan(0);
    expect(screen.getByText("20 Aug 2026, 10:00 AM")).toBeInTheDocument();
    expect(screen.queryByText("2026-08-20T10:00:00.000Z")).not.toBeInTheDocument();
  });

  it("opens application detail with document metadata only", async () => {
    renderWithFetch();
    await openOnlyViewButton();
    expect(screen.getByText("student-card.pdf")).toBeInTheDocument();
    expect(screen.getByText("19 Aug 2026, 9:15 AM")).toBeInTheDocument();
    expect(screen.getByText(/Private R2 file content is never exposed/)).toBeInTheDocument();
    expect(screen.getByText(/Approval does not create a booking/)).toBeInTheDocument();
    expect(screen.queryByText(/Final booking still requires an academic session/)).not.toBeInTheDocument();
  });

  it("does not expose frontend application-number generation or creation", async () => {
    renderWithFetch();
    await screen.findByText("KSM-APP-0011");
    expect(screen.queryByRole("button", { name: /add application/i })).not.toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/applications") && init?.method === "POST")).toBe(false);
  });

  it("moves submitted applications to under review", async () => {
    renderWithFetch();
    await openOnlyViewButton();
    await userEvent.click(screen.getByRole("button", { name: "Start Review" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      const patchCall = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/applications/11/status") && init?.method === "PATCH");
      expect(patchCall).toBeTruthy();
      expect(String(patchCall?.[1]?.body)).toContain("under_review");
    });
  });

  it("approves under-review applications without booking or allocation requests", async () => {
    renderWithFetch({ applications: [reviewApplication] });
    await openOnlyViewButton();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("The applicant will become eligible for booking. No room or bed will be allocated automatically.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/applications/12/status"))).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/admin/bookings"))).toBe(false);
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/admin/allocations"))).toBe(false);
  });

  it("rejects under-review applications with decision notes", async () => {
    renderWithFetch({ applications: [reviewApplication] });
    await openOnlyViewButton();
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.type(screen.getByLabelText("Decision notes"), "Missing guardian details");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      const patchCall = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/applications/12/status") && init?.method === "PATCH");
      expect(String(patchCall?.[1]?.body)).toContain("Missing guardian details");
      expect(String(patchCall?.[1]?.body)).toContain("rejected");
    });
  });

  it("hides invalid actions for approved applications", async () => {
    renderWithFetch({ applications: [approvedApplication] });
    await openOnlyViewButton();
    expect(screen.queryByRole("button", { name: "Start Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("hides review actions for roles without application write permission", async () => {
    renderWithFetch({ role: "accounts" });
    await openOnlyViewButton();
    expect(screen.queryByRole("button", { name: "Start Review" })).not.toBeInTheDocument();
    expect(screen.getByText(/this role cannot change application status/i)).toBeInTheDocument();
  });

  it("submits server-side application search", async () => {
    renderWithFetch();
    await screen.findByText("KSM-APP-0011");
    await userEvent.type(screen.getByLabelText(/search applications/i), "KSM-APP");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("search=KSM-APP"), expect.anything()));
  });

  it("shows application API error state", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return json({ user: manager });
      return json({ error: { message: "Unable to load applications." } }, 500);
    });
    render(<MemoryRouter><AuthProvider><ApplicationsPage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load applications.");
  });

  it("shows transition failure without closing the decision dialog", async () => {
    renderWithFetch({ failPatch: true });
    await openOnlyViewButton();
    await userEvent.click(screen.getByRole("button", { name: "Start Review" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid workflow transition");
    expect(within(screen.getByRole("dialog", { name: "Under Review application" })).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });


  it("shows Create Agreement for approved applications and posts management agreement", async () => {
    renderWithFetch({ applications: [approvedApplication] });
    await openOnlyViewButton();
    expect(screen.getByText("REQUEST (applicant intent — not the final agreement)")).toBeInTheDocument();
    expect(screen.getAllByText("Short-Term").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Create Agreement" }));
    expect(await screen.findByRole("heading", { name: "Create Agreement" })).toBeInTheDocument();
    expect(screen.getByText("MANAGEMENT AGREEMENT")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Lease Period"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Room"), "1");
    await waitFor(() => expect(screen.getByText(/ST-2P/)).toBeInTheDocument());
    expect(screen.getByText(/Academic Session not required/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Maintenance Fee/));
    await userEvent.type(screen.getByLabelText(/Maintenance Fee/), "15000");
    await userEvent.click(screen.getByRole("button", { name: "Save Agreement" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/bookings/from-rate-card") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(String(post?.[1]?.body)).toContain('"leasePeriodId":3');
      expect(String(post?.[1]?.body)).toContain('"roomId":1');
      expect(String(post?.[1]?.body)).toContain('"maintenanceFeeMinor":15000');
    });
  });

  it("hides Create Agreement for accounts role", async () => {
    renderWithFetch({ role: "accounts", applications: [approvedApplication] });
    await openOnlyViewButton();
    expect(screen.queryByRole("button", { name: "Create Agreement" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only Super Admin \/ Manager can create agreements/i)).toBeInTheDocument();
  });

});
