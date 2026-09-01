import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { StaffPage } from "./StaffPage";

const superAdmin = { id: 1, userType: "staff", displayName: "Root", email: "root@test", role: "super_admin", staffId: 1, residentId: null, sessionId: 1 };
const managerUser = { ...superAdmin, role: "manager", staffId: 2 };
const staff = {
  id: 2,
  user_id: 12,
  role_id: 2,
  staff_code: "KSM-STF-002",
  job_title: "Hostel Manager",
  status: "active",
  staff_status: "active",
  display_name: "Ama Manager",
  username: "ama.manager",
  email: "ama@test",
  phone: "+233000000000",
  user_status: "active",
  user_created_at: "2026-08-28T03:37:35.599Z",
  role_code: "manager",
  role_name: "Manager",
  created_at: "2026-08-28T03:37:35.599Z"
};
const roles = [
  { id: 1, code: "super_admin", name: "Super Admin" },
  { id: 2, code: "manager", name: "Manager" },
  { id: 3, code: "reception", name: "Reception" },
  { id: 4, code: "accounts", name: "Accounts" },
  { id: 5, code: "maintenance", name: "Maintenance" }
];

function list(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, pagination: { limit: 25, offset: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: { "Content-Type": "application/json" } });
}

function mockStaff(role: "super_admin" | "manager" = "super_admin", fail = false) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "super_admin" ? superAdmin : managerUser }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (fail && url.includes("/admin/staff?")) return new Response(JSON.stringify({ error: { message: "Unable to load staff." } }), { status: 500, headers: { "Content-Type": "application/json" } });
    if (url.includes("/admin/staff?")) return list([staff]);
    if (url.endsWith("/admin/roles?limit=100&offset=0")) return list(roles);
    if (url.endsWith("/admin/staff/2") && !init?.method) return json(staff);
    if (url.endsWith("/admin/staff") && init?.method === "POST") return json({ staff: { ...staff, id: 3, staff_code: "KSM-STF-003", display_name: "New Staff", email: "new@test" }, initialPassword: "TempPass123" }, 201);
    if (url.endsWith("/admin/staff/2/role") && init?.method === "PATCH") return json({ ...staff, role_id: 3, role_code: "reception", role_name: "Reception" });
    if (url.endsWith("/admin/staff/2/status") && init?.method === "PATCH") return json({ ...staff, staff_status: "inactive" });
    if (url.endsWith("/admin/staff/2/account-status") && init?.method === "PATCH") return json({ ...staff, user_status: "suspended" });
    if (url.endsWith("/admin/staff/2/reset-password") && init?.method === "POST") return json({ staff, temporaryPassword: "ResetPass123" });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><StaffPage /></AuthProvider></MemoryRouter>);
}

describe("StaffPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders joined staff account and role fields", async () => {
    mockStaff();
    expect(await screen.findByRole("heading", { name: "Staff" })).toBeInTheDocument();
    expect(await screen.findByText("KSM-STF-002")).toBeInTheDocument();
    expect(screen.getByText("Ama Manager")).toBeInTheDocument();
    expect(screen.getByText("ama.manager")).toBeInTheDocument();
    expect(screen.getByText("ama@test")).toBeInTheDocument();
    expect(screen.getAllByText("Manager").length).toBeGreaterThan(0);
    expect(screen.queryByText(/password_hash/i)).not.toBeInTheDocument();
  });

  it("submits server-side staff search", async () => {
    mockStaff();
    await screen.findByText("KSM-STF-002");
    await userEvent.type(screen.getByLabelText(/search staff/i), "Ama");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("search=Ama"))).toBe(true));
  });

  it("creates staff without sending password hashes and shows the initial password once", async () => {
    mockStaff();
    await userEvent.click(await screen.findByRole("button", { name: /add staff/i }));
    await userEvent.type(screen.getByLabelText("Display name"), "New Staff");
    await userEvent.type(screen.getByLabelText("Username"), "new.staff");
    await userEvent.type(screen.getByLabelText("Email"), "new@test");
    await userEvent.type(screen.getByLabelText("Staff code"), "KSM-STF-003");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "3");
    await userEvent.type(screen.getByLabelText("Initial password"), "PlainTemp123");
    await userEvent.click(screen.getByRole("button", { name: "Create Staff" }));

    expect(await screen.findByText("TempPass123")).toBeInTheDocument();
    const postCall = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/staff") && init?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(String(postCall?.[1]?.body)).not.toContain("password_hash");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("TempPass123")).not.toBeInTheDocument();
  });

  it("allows Super Admin staff management actions through confirmed backend calls", async () => {
    mockStaff();
    await userEvent.click(await screen.findByRole("button", { name: /view/i }));
    expect(await screen.findByText("Staff Details")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Change role"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/staff/2/role"))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Reset Password" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("ResetPass123")).toBeInTheDocument();
  });

  it("hides staff management actions from managers", async () => {
    mockStaff("manager");
    expect(await screen.findByText("KSM-STF-002")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add staff/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /view/i }));
    expect(await screen.findByText(/staff management actions require super admin access/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset Password" })).not.toBeInTheDocument();
  });

  it("shows API error state", async () => {
    mockStaff("super_admin", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load staff.");
  });
});
