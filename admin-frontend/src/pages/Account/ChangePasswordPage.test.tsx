import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AppRoutes } from "../../routes/AppRoutes";
import { passwordProblems } from "../../utils/passwordPolicy";

const baseUser = { id: 1, userType: "staff", displayName: "Manager", email: "ops@example.test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const NEW_PW = "Brand-New-Secret-Phrase-03";

function mockFetch(opts: { mustChange: boolean; changeFails?: { status: number; code: string; message: string } }) {
  let mustChange = opts.mustChange;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: { ...baseUser, mustChangePassword: mustChange } }), { status: 200 });
    if (url.endsWith("/auth/staff/login")) return new Response(JSON.stringify({ token: "t", expiresAt: "2099-01-01T00:00:00Z", mustChangePassword: mustChange, user: { id: 1, name: "Manager", role: "manager", mustChangePassword: mustChange } }), { status: 200 });
    if (url.endsWith("/auth/staff/change-password") && init?.method === "POST") {
      if (opts.changeFails) return new Response(JSON.stringify({ ok: false, error: { code: opts.changeFails.code, message: opts.changeFails.message } }), { status: opts.changeFails.status });
      mustChange = false;
      return new Response(JSON.stringify({ ok: true, data: { mustChangePassword: false, revokedOtherSessions: 2 } }), { status: 200 });
    }
    if (url.endsWith("/auth/logout")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.includes("/admin/")) return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    return new Response(null, { status: 404 });
  });
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
}

describe("password policy mirror", () => {
  it("matches the backend rules", () => {
    expect(passwordProblems(NEW_PW)).toEqual([]);
    expect(passwordProblems("short").length).toBeGreaterThan(0);
    expect(passwordProblems("Password123!")).toContain("Not a common password");
    expect(passwordProblems("Ops-Secret-Pass-9", { email: "ops@example.test" })).toContain("Must not contain your username or email");
  });
});

describe("ChangePasswordPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("forces flagged staff onto the change-password screen from any route", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    mockFetch({ mustChange: true });
    renderAt("/bookings");
    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();
    expect(screen.getByText(/must choose a new password/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /back to dashboard/i })).toBeNull();
    const calls = vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.includes("/admin/"))).toBe(false);
  });

  it("redirects to the forced screen after a login that requires rotation, then into the portal after changing", async () => {
    const fetchMock = mockFetch({ mustChange: true });
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email or username"), "ops.manager");
    await userEvent.type(screen.getByLabelText("Password"), "Temp-Pass-From-Admin-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Current password"), "Temp-Pass-From-Admin-1");
    await userEvent.type(screen.getByLabelText("New password"), NEW_PW);
    await userEvent.type(screen.getByLabelText("Confirm new password"), NEW_PW);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set a new password" })).toBeNull());
    const post = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/auth/staff/change-password") && i?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ currentPassword: "Temp-Pass-From-Admin-1", newPassword: NEW_PW });
  });

  it("validates locally and shows backend errors (voluntary change)", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    mockFetch({ mustChange: false, changeFails: { status: 400, code: "PASSWORD_CURRENT_INVALID", message: "Current password is incorrect" } });
    renderAt("/change-password");
    expect(await screen.findByRole("heading", { name: "Change password" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Current password"), "Whatever-Current-1");
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not meet the requirements/i);
    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), NEW_PW);
    await userEvent.type(screen.getByLabelText("Confirm new password"), NEW_PW);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect");
  });

  it("is reachable from the top bar for unflagged staff", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    mockFetch({ mustChange: false });
    renderAt("/dashboard");
    await userEvent.click(await screen.findByRole("link", { name: "Change password" }));
    expect(await screen.findByRole("heading", { name: "Change password" })).toBeInTheDocument();
  });
});
