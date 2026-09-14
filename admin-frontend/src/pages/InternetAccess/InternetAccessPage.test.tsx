import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { InternetAccessPage } from "./InternetAccessPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception" };

const account = {
  id: 1,
  resident_id: 7,
  router_username: "KSM-RES-0007",
  router_profile: "Kissmet-Residents",
  status: "active",
  sync_status: "synced",
  last_synced_at: "2026-09-14T12:00:00.000Z",
  last_sync_error: null,
  created_at: "2026-09-14T10:00:00.000Z",
  updated_at: "2026-09-14T12:00:00.000Z",
  resident_code: "KSM-RES-0007",
  first_name: "Ama",
  last_name: "Mensah",
  room_code: "ROOM-101",
  bed_code: "ROOM-101-A",
  has_active_allocation: 1
};

const eligible = {
  id: 7,
  resident_code: "KSM-RES-0007",
  first_name: "Ama",
  last_name: "Mensah",
  room_code: "ROOM-101",
  bed_code: "ROOM-101-A",
  internet_account_id: null,
  internet_status: null,
  internet_sync_status: null,
  already_provisioned: 0
};

function ok(data: unknown, pagination = { limit: 25, offset: 0 }) {
  return new Response(JSON.stringify({ ok: true, data, pagination }), { status: 200 });
}

function renderPage(role: "manager" | "reception" = "manager") {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "manager" ? manager : reception }), { status: 200 });
    if (url.includes("/admin/internet-access/summary")) return ok({ total: 1, active: 1, suspended: 0, sync_failed: 0, pending: 0 });
    if (url.includes("/admin/internet-access/connector-health")) return ok({ ok: true, configured: true, board: "hAP", version: "7.16" });
    if (url.includes("/admin/internet-access/eligible-residents")) return ok([eligible]);
    if (url.includes("/admin/internet-access/1/sessions")) return ok([]);
    if (url.match(/\/admin\/internet-access\/1$/) && (!init?.method || init.method === "GET")) return ok(account);
    if (url.includes("/admin/internet-access?") || url.endsWith("/admin/internet-access")) return ok([account]);
    if (url.includes("/admin/internet-access/residents/7/provision") && init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true, data: { ...account, password: "OnceOnlyPass!23" } }), { status: 201 });
    }
    if (url.includes("/admin/internet-access/1/suspend") && init?.method === "POST") {
      return ok({ ...account, status: "suspended" });
    }
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><InternetAccessPage /></AuthProvider></MemoryRouter>);
}

describe("InternetAccessPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads accounts, summary, and connector health", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Internet Access" })).toBeInTheDocument();
    expect((await screen.findAllByText("KSM-RES-0007")).length).toBeGreaterThan(0);
    expect(screen.getByText("ROOM-101 / ROOM-101-A")).toBeInTheDocument();
    expect(screen.getAllByText(/3 simultaneous devices/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Reachable/i)).toBeInTheDocument();
  });

  it("hides provision for roles without internet manage", async () => {
    renderPage("reception");
    expect(await screen.findByText(/does not include internet:read/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /provision resident/i })).not.toBeInTheDocument();
  });

  it("submits server-side search and status filters", async () => {
    renderPage();
    await screen.findAllByText("KSM-RES-0007");
    await userEvent.type(screen.getByLabelText(/search accounts/i), "Ama");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("search=Ama"), expect.anything()));
    await userEvent.selectOptions(screen.getByLabelText(/internet status filter/i), "suspended");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("status=suspended"), expect.anything()));
  });

  it("opens detail and can start suspend confirm", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /view/i }));
    expect(await screen.findByText("Internet Account")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByText(/Suspend internet access/i)).toBeInTheDocument();
  });

  it("provisions resident and shows one-time password", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /provision resident/i }));
    expect(await screen.findByText("Provision Internet Access")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Select" }));
    await userEvent.click(screen.getByRole("button", { name: "Provision" }));
    expect(await screen.findByText(/One-time password/i)).toBeInTheDocument();
    expect(screen.getByText("OnceOnlyPass!23")).toBeInTheDocument();
    const bodies = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[1]?.body ?? ""));
    expect(bodies.join(" ")).not.toMatch(/OnceOnlyPass!23/);
  });
});
