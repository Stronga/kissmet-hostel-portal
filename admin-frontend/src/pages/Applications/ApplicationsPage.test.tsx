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
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "applicant" };
const submittedApplication = { id: 11, resident_id: 7, academic_session_id: 1, application_number: "KSM-APP-0011", status: "submitted", submitted_at: "2026-08-20T10:00:00.000Z", created_at: "2026-08-19T09:15:00.000Z", updated_at: "2026-08-20T10:00:00.000Z", decision_notes: null };
const reviewApplication = { ...submittedApplication, id: 12, application_number: "KSM-APP-0012", status: "under_review" };
const approvedApplication = { ...submittedApplication, id: 13, application_number: "KSM-APP-0013", status: "approved" };
const documentRow = { id: 30, resident_id: 7, document_type: "student_card", status: "uploaded", original_filename: "student-card.pdf", content_type: "application/pdf", size_bytes: 1200 };

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
    if (url.endsWith("/admin/documents")) return json({ ok: true, data: [documentRow] });
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
});
