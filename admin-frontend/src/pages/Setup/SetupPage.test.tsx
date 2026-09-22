import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { SetupPage } from "./SetupPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception", displayName: "Reception" };

const institution = { id: 1, code: "UG", name: "University of Ghana", status: "active" };
const institutionTwo = { id: 2, code: "KNUST", name: "KNUST", status: "inactive" };
const session = { id: 1, code: "2026", name: "2026/2027", starts_on: "2026-09-01", ends_on: "2027-06-30", status: "draft" };
const sessionTwo = { id: 2, code: "2025", name: "2025/2026", starts_on: "2025-09-01", ends_on: "2026-06-30", status: "active" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 100, offset: 0 } });
}

function renderSetup(options: {
  role?: "manager" | "reception";
  institutions?: unknown[];
  sessions?: unknown[];
  failLoad?: boolean;
  failCreateInstitution?: boolean;
  failCreateSession?: boolean;
} = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  const institutions = options.institutions ?? [institution, institutionTwo];
  const sessions = options.sessions ?? [session, sessionTwo];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "reception" ? reception : manager });
    if (options.failLoad && (url.includes("/admin/institutions") || url.includes("/admin/academic-sessions")) && (!init?.method || init.method === "GET")) {
      return json({ error: { message: "Unable to load setup data" } }, 500);
    }
    if (url.includes("/admin/institutions?") || url.endsWith("/admin/institutions?limit=100&offset=0")) return list(institutions);
    if (url.endsWith("/admin/institutions") && init?.method === "POST") {
      if (options.failCreateInstitution) return json({ error: { message: "Institution code already exists" } }, 409);
      const body = JSON.parse(String(init.body ?? "{}")) as { code: string; name: string; status?: string };
      return json({ ok: true, data: { id: 3, code: body.code, name: body.name, status: body.status ?? "active" } }, 201);
    }
    if (url.endsWith("/admin/institutions/1/status") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as { status: string };
      return json({ ok: true, data: { ...institution, status: body.status } });
    }
    if (url.includes("/admin/academic-sessions?") || url.endsWith("/admin/academic-sessions?limit=100&offset=0")) return list(sessions);
    if (url.endsWith("/admin/academic-sessions") && init?.method === "POST") {
      if (options.failCreateSession) return json({ error: { message: "Session date range is invalid" } }, 400);
      const body = JSON.parse(String(init.body ?? "{}")) as { code: string; name: string; startsOn: string; endsOn: string; status?: string };
      return json({
        ok: true,
        data: {
          id: 3,
          code: body.code,
          name: body.name,
          starts_on: body.startsOn,
          ends_on: body.endsOn,
          status: body.status ?? "draft"
        }
      }, 201);
    }
    if (url.endsWith("/admin/academic-sessions/1/status") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as { status: string };
      return json({ ok: true, data: { ...session, status: body.status } });
    }
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><SetupPage /></AuthProvider></MemoryRouter>);
}

describe("SetupPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders institution and academic session lists", async () => {
    renderSetup();
    expect(await screen.findByRole("heading", { name: "Setup" })).toBeInTheDocument();
    expect(screen.getByText("UG")).toBeInTheDocument();
    expect(screen.getByText("University of Ghana")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Academic Sessions" }));
    expect(await screen.findByText("2026/2027")).toBeInTheDocument();
    expect(screen.getByText("2025/2026")).toBeInTheDocument();
  });

  it("creates an institution with POST body and refreshes the list", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("button", { name: /create institution/i }));
    await userEvent.type(screen.getByLabelText("Institution Code"), "UCC");
    await userEvent.type(screen.getByLabelText("Institution Name"), "University of Cape Coast");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Institution" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/institutions") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ code: "UCC", name: "University of Cape Coast", status: "active" });
    });
    await waitFor(() => {
      const listCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([url, init]) => String(url).includes("/admin/institutions") && (!init?.method || init.method === "GET"));
      expect(listCalls.length).toBeGreaterThan(1);
    });
  });

  it("validates required institution fields locally", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("button", { name: /create institution/i }));
    await userEvent.click(screen.getAllByRole("button", { name: "Create Institution" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Institution code and name are required.");
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/institutions") && init?.method === "POST")).toBe(false);
  });

  it("surfaces backend errors when creating an institution", async () => {
    renderSetup({ failCreateInstitution: true });
    await userEvent.click(await screen.findByRole("button", { name: /create institution/i }));
    await userEvent.type(screen.getByLabelText("Institution Code"), "UG");
    await userEvent.type(screen.getByLabelText("Institution Name"), "Duplicate");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Institution" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Institution code already exists");
  });

  it("changes institution status through confirmation", async () => {
    renderSetup();
    await screen.findByText("UG");
    await userEvent.click(screen.getAllByRole("button", { name: "Set Inactive" })[0]);
    expect(screen.getByText(/Change institution status from Active to Inactive/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/institutions/1/status") && init?.method === "PATCH")).toBe(true);
    });
  });

  it("creates an academic session with YYYY-MM-DD startsOn and endsOn", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("tab", { name: "Academic Sessions" }));
    await userEvent.click(await screen.findByRole("button", { name: /create academic session/i }));
    await userEvent.type(screen.getByLabelText("Session Code"), "2027");
    await userEvent.type(screen.getByLabelText("Session Name"), "2027/2028");
    await userEvent.type(screen.getByLabelText("Start Date"), "2027-09-01");
    await userEvent.type(screen.getByLabelText("End Date"), "2028-06-30");
    await userEvent.click(screen.getByRole("button", { name: "Create Session" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/academic-sessions") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        code: "2027",
        name: "2027/2028",
        startsOn: "2027-09-01",
        endsOn: "2028-06-30",
        status: "draft"
      });
    });
  });

  it("surfaces backend session create error for valid client dates", async () => {
    renderSetup({ failCreateSession: true });
    await userEvent.click(await screen.findByRole("tab", { name: "Academic Sessions" }));
    await userEvent.click(await screen.findByRole("button", { name: /create academic session/i }));
    await userEvent.type(screen.getByLabelText("Session Code"), "2027");
    await userEvent.type(screen.getByLabelText("Session Name"), "2027/2028");
    await userEvent.type(screen.getByLabelText("Start Date"), "2027-09-01");
    await userEvent.type(screen.getByLabelText("End Date"), "2028-06-30");
    await userEvent.click(screen.getByRole("button", { name: "Create Session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Session date range is invalid");
  });

  it("changes academic session status through confirmation", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("tab", { name: "Academic Sessions" }));
    await screen.findByText("2026/2027");
    await userEvent.click(screen.getAllByRole("button", { name: "Activate" })[0]);
    expect(screen.getByText(/Activating this session will close any other active academic session/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/academic-sessions/1/status") && init?.method === "PATCH")).toBe(true);
    });
  });

  it("hides mutation controls for roles without admin:write", async () => {
    renderSetup({ role: "reception" });
    await screen.findByText("UG");
    expect(screen.queryByRole("button", { name: /create institution/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set Inactive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Academic Sessions" }));
    await screen.findByText("2026/2027");
    expect(screen.queryByRole("button", { name: /create academic session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("shows API failure state on load", async () => {
    renderSetup({ failLoad: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load setup data");
  });
});
