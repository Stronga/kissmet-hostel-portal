import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AuditLogsPage } from "./AuditLogsPage";
import { AppRoutes } from "../../routes/AppRoutes";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const maintenance = { ...manager, role: "maintenance" };
const log = {
  id: 10,
  actor_user_id: 1,
  actor_staff_id: 1,
  actor_display_name: "Kissmet Admin",
  actor_staff_code: "KSM-STF-0001",
  actor_role_code: "manager",
  actor_role_name: "Manager",
  action: "admin.payment.verified",
  entity_type: "payment",
  entity_id: 4,
  metadata: { bookingId: 2, password: "[REDACTED]", nested: { sessionToken: "[REDACTED]" } },
  ip_hash: "ip-hash",
  user_agent: "Vitest Browser",
  created_at: "2026-08-31T20:08:00.000Z"
};

function list(data: unknown, total = 40) {
  return new Response(JSON.stringify({ ok: true, data, pagination: { limit: 25, offset: 0, total } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function json(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function mockAudit(role: "manager" | "maintenance" = "manager", empty = false) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "manager" ? manager : maintenance }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/admin/audit-logs?")) return list(empty ? [] : [log]);
    if (url.endsWith("/admin/audit-logs/10")) return json(log);
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><AuditLogsPage /></AuthProvider></MemoryRouter>);
}

describe("AuditLogsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders audit logs with human-readable timestamps and no mutation actions", async () => {
    mockAudit();
    expect(await screen.findByRole("heading", { name: "Audit Logs" })).toBeInTheDocument();
    expect(await screen.findByText("Kissmet Admin")).toBeInTheDocument();
    expect(screen.getByText("31 Aug 2026, 8:08 PM")).toBeInTheDocument();
    expect(screen.getByText("Payment Verified")).toBeInTheDocument();
    expect(screen.getByText("Payment #4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add|edit|delete|clear logs|purge/i })).not.toBeInTheDocument();
  });

  it("sends filter parameters to the backend", async () => {
    mockAudit();
    await screen.findByText("Kissmet Admin");
    await userEvent.type(screen.getByLabelText("Search audit logs"), "payment");
    await userEvent.type(screen.getByLabelText("Actor User ID"), "1");
    await userEvent.type(screen.getByLabelText("Actor Staff ID"), "1");
    await userEvent.type(screen.getByLabelText("Action"), "admin.payment.verified");
    await userEvent.type(screen.getByLabelText("Entity Type"), "payment");
    await userEvent.type(screen.getByLabelText("Date From"), "2026-08-01");
    await userEvent.type(screen.getByLabelText("Date To"), "2026-09-01");
    await userEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("search=payment") && String(url).includes("actorStaffId=1") && String(url).includes("entityType=payment"))).toBe(true);
    });
  });

  it("opens detail modal with actor target context and redacted metadata", async () => {
    mockAudit();
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    expect(await screen.findByText("Audit Log Details")).toBeInTheDocument();
    expect(screen.getByText("Exact action key")).toBeInTheDocument();
    expect(screen.getAllByText("admin.payment.verified").length).toBeGreaterThan(0);
    expect(screen.getByText("KSM-STF-0001")).toBeInTheDocument();
    expect(screen.getByText("ip-hash")).toBeInTheDocument();
    expect(screen.getAllByText("[REDACTED]").length).toBeGreaterThan(0);
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
  });

  it("shows missing values and empty states without fabricating information", async () => {
    mockAudit("manager", true);
    expect(await screen.findByText("No audit activity found.")).toBeInTheDocument();
  });

  it("paginates through backend pages", async () => {
    mockAudit();
    await screen.findByText("Showing 1-1 of 40");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("offset=25"))).toBe(true));
  });

  it("hides Audit Logs navigation from unauthorized roles", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: maintenance }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(null, { status: 404 });
    });
    render(<MemoryRouter initialEntries={["/dashboard"]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit Logs" })).not.toBeInTheDocument();
  });
});
