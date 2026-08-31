import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { MaintenancePage } from "./MaintenancePage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts = { ...manager, role: "accounts" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "resident" };
const institution = { id: 1, code: "UG", name: "University of Ghana", status: "active" };
const room = { id: 2, room_code: "ROOM-101", room_name: "Room 101", capacity: 2, gender_policy: "female", status: "available" };
const bed = { id: 3, room_id: 2, bed_code: "BED-A", label: "A", status: "available" };
const staff = [{ id: 4, user_id: 9, role_id: 5, staff_code: "KSM-STF-0004", job_title: "Maintenance Lead", status: "active" }];
const requests = [
  { id: 1, request_number: "KSM-MNT-0001", resident_id: 7, room_id: 2, bed_id: 3, category: "electrical", priority: "urgent", status: "open", title: "Broken fan", description: "Fan stopped working", opened_at: "2026-08-28T03:37:35.599Z" },
  { id: 2, request_number: "KSM-MNT-0002", resident_id: 7, room_id: 2, bed_id: 3, category: "plumbing", priority: "normal", status: "assigned", title: "Leaking tap", assigned_to_staff_id: 4, assigned_at: "2026-08-29T03:37:35.599Z", opened_at: "2026-08-29T02:37:35.599Z" }
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 100, offset: 0 } });
}

function renderMaintenance(options: { role?: "manager" | "accounts"; failLoad?: boolean; failCreate?: boolean; failAssign?: boolean; failTransition?: boolean; request?: Record<string, unknown> } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "accounts" ? accounts : manager });
    if (url.includes("/admin/maintenance?")) return options.failLoad ? json({ error: { message: "Unable to load maintenance" } }, 500) : list([options.request ?? requests[0], requests[1]]);
    if (url.endsWith("/admin/dashboard/maintenance")) return json({ ok: true, data: { open: 1, assigned: 1, in_progress: 0, resolved: 2, closed: 1, urgent: 1 } });
    if (url.endsWith("/admin/residents?limit=100&offset=0")) return list([resident]);
    if (url.endsWith("/admin/institutions?limit=100&offset=0")) return list([institution]);
    if (url.endsWith("/admin/rooms?limit=100&offset=0")) return list([room]);
    if (url.endsWith("/admin/rooms/2/beds?limit=100&offset=0")) return list([bed]);
    if (url.endsWith("/admin/staff?limit=100&offset=0")) return list(staff);
    if (url.endsWith("/admin/maintenance/1")) return json({ ok: true, data: options.request ?? requests[0] });
    if (url.endsWith("/admin/maintenance/2")) return json({ ok: true, data: requests[1] });
    if (url.endsWith("/admin/maintenance/4") && options.request) return json({ ok: true, data: options.request });
    if (url.endsWith("/admin/maintenance/5") && options.request) return json({ ok: true, data: options.request });
    if (url.endsWith("/admin/maintenance") && init?.method === "POST") return options.failCreate ? json({ error: { message: "category is required" } }, 400) : json({ ok: true, data: { ...requests[0], id: 3, request_number: "KSM-MNT-0003", title: "Broken socket" } }, 201);
    if (url.endsWith("/admin/maintenance/1/assign")) return options.failAssign ? json({ error: { message: "Staff cannot be assigned to maintenance" } }, 400) : json({ ok: true, data: { ...requests[0], status: "assigned", assigned_to_staff_id: 4, assigned_at: "2026-08-30T03:37:35.599Z" } });
    if (url.endsWith("/admin/maintenance/2/start")) return options.failTransition ? json({ error: { message: "Invalid workflow transition" } }, 400) : json({ ok: true, data: { ...requests[1], status: "in_progress", started_at: "2026-08-30T03:37:35.599Z" } });
    if (url.endsWith("/admin/maintenance/1/cancel")) return json({ ok: true, data: { ...requests[0], status: "cancelled" } });
    if (url.endsWith("/admin/maintenance/4/resolve")) return json({ ok: true, data: { id: 4, request_number: "KSM-MNT-0004", category: "other", priority: "normal", status: "resolved", title: "Done", resolved_at: "2026-08-31T03:37:35.599Z" } });
    if (url.endsWith("/admin/maintenance/5/close")) return json({ ok: true, data: { id: 5, request_number: "KSM-MNT-0005", category: "other", priority: "normal", status: "closed", title: "Closed", closed_at: "2026-08-31T04:37:35.599Z" } });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><MaintenancePage /></AuthProvider></MemoryRouter>);
}

async function openRequest(index = 0, requestNumber = "KSM-MNT-0001") {
  await waitFor(() => expect(screen.getByText(requestNumber)).toBeInTheDocument());
  await userEvent.click(screen.getAllByRole("button", { name: "View" })[index]);
  return screen.findByText("Maintenance Details");
}

describe("MaintenancePage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders maintenance list with dashboard counts, context, and human-readable dates", async () => {
    renderMaintenance();
    expect(await screen.findByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
    expect(screen.getByText("KSM-MNT-0001")).toBeInTheDocument();
    expect(screen.getByText("Broken fan")).toBeInTheDocument();
    expect(screen.getAllByText("Ama Mensah").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/ROOM-101/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BED-A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Urgent").length).toBeGreaterThan(0);
    expect(screen.getByText("28 Aug 2026, 3:37 AM")).toBeInTheDocument();
  });

  it("renders maintenance detail with resident and stored placement context", async () => {
    renderMaintenance();
    await openRequest();
    expect(screen.getByText("Request")).toBeInTheDocument();
    expect(screen.getByText("KSM-RES-0007")).toBeInTheDocument();
    expect(screen.getByText("University of Ghana")).toBeInTheDocument();
    expect(screen.getAllByText(/ROOM-101/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BED-A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not stored on maintenance request").length).toBeGreaterThan(0);
  });

  it("creates requests without frontend-generated maintenance numbers or inventory mutations", async () => {
    renderMaintenance();
    await userEvent.click(await screen.findByRole("button", { name: /create request/i }));
    await userEvent.selectOptions(screen.getByLabelText("Maintenance resident"), "7");
    await userEvent.selectOptions(screen.getByLabelText("Maintenance room"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Maintenance bed"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Maintenance category"), "electrical");
    await userEvent.type(screen.getByLabelText("Maintenance issue"), "Broken socket");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Request" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/maintenance") && init?.method === "POST");
      expect(String(post?.[1]?.body)).toContain("\"residentId\":7");
      expect(String(post?.[1]?.body)).not.toContain("request_number");
    });
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls.some(([url]) => String(url).includes("/admin/rooms/2/status"))).toBe(false);
    expect(calls.some(([url]) => String(url).includes("/admin/beds/3/status"))).toBe(false);
    expect(calls.some(([url]) => String(url).includes("/admin/allocations"))).toBe(false);
  });

  it("surfaces create failures", async () => {
    renderMaintenance({ failCreate: true });
    await userEvent.click(await screen.findByRole("button", { name: /create request/i }));
    await userEvent.type(screen.getByLabelText("Maintenance issue"), "Broken socket");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Request" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("category is required");
  });

  it("assigns a valid request through the assignment endpoint", async () => {
    renderMaintenance();
    await openRequest();
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    await userEvent.selectOptions(screen.getByLabelText("Assigned maintenance staff"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Assign Request" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/maintenance/1/assign"))).toBe(true));
  });

  it("surfaces assignment failures", async () => {
    renderMaintenance({ failAssign: true });
    await openRequest();
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    await userEvent.selectOptions(screen.getByLabelText("Assigned maintenance staff"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Assign Request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Staff cannot be assigned to maintenance");
  });

  it("shows valid status actions and starts assigned work", async () => {
    renderMaintenance();
    await openRequest(1);
    expect(screen.getByRole("button", { name: "Start Work" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start Work" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/maintenance/2/start"))).toBe(true));
  });

  it("supports resolve, close, and cancel workflows where valid", async () => {
    renderMaintenance({ request: { id: 4, request_number: "KSM-MNT-0004", resident_id: 7, room_id: 2, bed_id: 3, category: "other", priority: "normal", status: "in_progress", title: "Paint touch-up" } });
    await openRequest(0, "KSM-MNT-0004");
    await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/maintenance/4/resolve"))).toBe(true));
  });

  it("closes resolved requests and cancels open requests without archive/delete calls", async () => {
    renderMaintenance({ request: { id: 5, request_number: "KSM-MNT-0005", resident_id: 7, room_id: 2, bed_id: 3, category: "other", priority: "normal", status: "resolved", title: "Ready to close" } });
    await openRequest(0, "KSM-MNT-0005");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/maintenance/5/close"))).toBe(true));

    cleanup();
    vi.restoreAllMocks();
    renderMaintenance();
    await openRequest();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/maintenance/1/cancel"))).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).includes("/admin/maintenance/1") && init?.method === "DELETE")).toBe(false);
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/archive"))).toBe(false);
  });

  it("surfaces transition failures", async () => {
    renderMaintenance({ failTransition: true });
    await openRequest(1);
    await userEvent.click(screen.getByRole("button", { name: "Start Work" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid workflow transition");
  });

  it("hides write actions for roles without maintenance permissions", async () => {
    renderMaintenance({ role: "accounts" });
    expect(await screen.findByText("KSM-MNT-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create request/i })).not.toBeInTheDocument();
    await openRequest();
    expect(screen.getByText("No maintenance management permission.")).toBeInTheDocument();
  });

  it("shows API error state", async () => {
    renderMaintenance({ failLoad: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load maintenance");
  });
});
