import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AppRoutes } from "../../routes/AppRoutes";
import { SettingsPage } from "./SettingsPage";

const superAdmin = { id: 1, userType: "staff", displayName: "Root", email: "root@test", role: "super_admin", staffId: 1, residentId: null, sessionId: 1 };
const manager = { ...superAdmin, role: "manager" };
const maintenance = { ...superAdmin, role: "maintenance" };
const settings = {
  general: { id: 1, organization_name: "Kissmet Hostel", admin_portal_title: "Kissmet Admin Portal", resident_portal_title: "Kissmet Resident Portal", support_email: "", support_phone: "", address_text: "", default_currency: "GHS" },
  academic: { activeSession: { id: 1, code: "2026-2027", name: "2026/2027 Academic Year", starts_on: "2026-09-01", ends_on: "2027-08-31", status: "active" } },
  paymentConfirmation: { id: 1, requirement_type: "full", fixed_amount_minor: null, percentage_basis_points: null, currency: "GHS", status: "active" },
  communications: { smsProvider: "Development / Mock", emailProvider: "Development / Mock", secretsManagedIn: "Cloudflare environment secrets" },
  system: { runtime: "Cloudflare Workers", framework: "Hono", database: "Cloudflare D1", documentStorage: "Private Cloudflare R2", authentication: "Staff password sessions and resident institution/student ID OTP", auditLogging: "Enabled" }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { ok: true, data } : { error: { message: "Unable to save settings." } }), { status, headers: { "Content-Type": "application/json" } });
}

function mockSettings(role: "super_admin" | "manager" | "maintenance" = "super_admin", fail = false) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "super_admin" ? superAdmin : role === "manager" ? manager : maintenance }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/admin/settings") && !init?.method) return fail ? json(null, 500) : json(settings);
    if (url.endsWith("/admin/settings/general") && init?.method === "PATCH") return json({ ...settings.general, organization_name: "Kissmet Group" });
    if (url.endsWith("/admin/settings/payment-confirmation") && init?.method === "PATCH") return json({ id: 1, requirement_type: "fixed", fixed_amount_minor: 125000, percentage_basis_points: null, currency: "GHS", status: "active" });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><SettingsPage /></AuthProvider></MemoryRouter>);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders editable and informational settings without secrets", async () => {
    mockSettings();
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kissmet Hostel")).toBeInTheDocument();
    expect(screen.getByText("2026/2027 Academic Year")).toBeInTheDocument();
    expect(screen.getAllByText("Development / Mock")).toHaveLength(2);
    expect(screen.getByText("Cloudflare D1")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secret-token|password_hash|plain-password/i);
  });

  it("lets Super Admin update general settings", async () => {
    mockSettings();
    const input = await screen.findByLabelText("Organization name");
    await userEvent.clear(input);
    await userEvent.type(input, "Kissmet Group");
    await userEvent.click(screen.getByRole("button", { name: "Save General Settings" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/settings/general") && init?.method === "PATCH" && String(init.body).includes("Kissmet Group"))).toBe(true));
  });

  it("keeps manager settings read-only", async () => {
    mockSettings("manager");
    expect(await screen.findByLabelText("Organization name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save General Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Payment Policy" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/read-only for your role/i).length).toBeGreaterThan(0);
  });

  it("converts fixed major-unit amounts to integer minor units", async () => {
    mockSettings();
    await screen.findByRole("heading", { name: "Settings" });
    await userEvent.selectOptions(screen.getByLabelText("Requirement"), "fixed");
    await userEvent.type(screen.getByLabelText("Fixed amount (GHS)"), "1250.00");
    await userEvent.click(screen.getByRole("button", { name: "Save Payment Policy" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Save" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/settings/payment-confirmation") && String(init?.body).includes("\"fixedAmountMinor\":125000"))).toBe(true));
  });

  it("converts percentage settings to basis points and validates input", async () => {
    mockSettings();
    await screen.findByRole("heading", { name: "Settings" });
    await userEvent.selectOptions(screen.getByLabelText("Requirement"), "percentage");
    await userEvent.type(screen.getByLabelText("Percentage"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Save Payment Policy" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Save" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/settings/payment-confirmation") && String(init?.body).includes("\"percentageBasisPoints\":5000"))).toBe(true));
  });

  it("shows validation and API errors", async () => {
    mockSettings();
    const name = await screen.findByLabelText("Organization name");
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole("button", { name: "Save General Settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Organization name and portal titles are required.");

    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
    mockSettings("super_admin", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save settings.");
  });

  it("hides settings navigation from unauthorized roles", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: maintenance }), { status: 200, headers: { "Content-Type": "application/json" } });
      return json({});
    });
    render(<MemoryRouter initialEntries={["/dashboard"]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });
});
