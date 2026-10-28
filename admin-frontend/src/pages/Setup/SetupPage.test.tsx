import { render, screen, waitFor, within } from "@testing-library/react";
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

const leaseAcademic = {
  id: 1,
  kind: "academic_calendar",
  code: "AC-2026",
  name: "Academic 2026/27",
  starts_on: "2026-09-01",
  ends_on: "2027-06-30",
  status: "draft",
  academic_session_id: 1,
  notes: null
};
const leaseCalendarYear = {
  id: 2,
  kind: "calendar_year",
  code: "CY-2027",
  name: "Calendar Year 2027",
  starts_on: "2027-01-01",
  ends_on: "2027-12-31",
  status: "active",
  academic_session_id: null,
  notes: null
};
const leaseShortTerm = {
  id: 3,
  kind: "short_term",
  code: "ST-Q1",
  name: "Short-Term Q1",
  starts_on: "2027-01-01",
  ends_on: "2027-03-31",
  status: "draft",
  academic_session_id: null,
  notes: null
};

const rateOne = {
  id: 1,
  lease_period_id: 1,
  occupancy_capacity: 1,
  rate_code: "AC-1P",
  amount_minor: 900000,
  currency: "GHS",
  package_months: null,
  status: "draft",
  effective_from: null,
  effective_to: null,
  notes: null
};
const rateTwo = {
  id: 2,
  lease_period_id: 1,
  occupancy_capacity: 2,
  rate_code: "AC-2P",
  amount_minor: 600000,
  currency: "GHS",
  package_months: null,
  status: "active",
  effective_from: null,
  effective_to: null,
  notes: null
};
const rateFour = {
  id: 3,
  lease_period_id: 3,
  occupancy_capacity: 4,
  rate_code: "ST-4P",
  amount_minor: 350000,
  currency: "GHS",
  package_months: 3,
  status: "draft",
  effective_from: "2027-01-01",
  effective_to: "2027-03-31",
  notes: null
};

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
  leasePeriods?: unknown[];
  rateCards?: unknown[];
  failLoad?: boolean;
  failCreateInstitution?: boolean;
  failCreateSession?: boolean;
  failCreateLease?: boolean | string;
  failCreateRate?: boolean | string;
} = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  const institutions = options.institutions ?? [institution, institutionTwo];
  const sessions = options.sessions ?? [session, sessionTwo];
  const leasePeriods = options.leasePeriods ?? [leaseAcademic, leaseCalendarYear, leaseShortTerm];
  const rateCards = options.rateCards ?? [rateOne, rateTwo, rateFour];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "reception" ? reception : manager });
    if (
      options.failLoad
      && (url.includes("/admin/institutions") || url.includes("/admin/academic-sessions") || url.includes("/admin/lease-periods") || url.includes("/admin/rate-cards"))
      && (!init?.method || init.method === "GET")
    ) {
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
    if (url.includes("/admin/lease-periods?") || url.endsWith("/admin/lease-periods?limit=100&offset=0")) return list(leasePeriods);
    if (url.endsWith("/admin/lease-periods") && init?.method === "POST") {
      if (options.failCreateLease) {
        const message = typeof options.failCreateLease === "string" ? options.failCreateLease : "Lease period code already exists";
        return json({ error: { message } }, 409);
      }
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      return json({
        ok: true,
        data: {
          id: 99,
          kind: body.kind,
          code: body.code,
          name: body.name,
          starts_on: body.startsOn,
          ends_on: body.endsOn,
          status: body.status ?? "draft",
          academic_session_id: body.academicSessionId ?? null,
          notes: body.notes ?? null
        }
      }, 201);
    }
    if (url.endsWith("/admin/lease-periods/1/status") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as { status: string };
      return json({ ok: true, data: { ...leaseAcademic, status: body.status } });
    }
    if (url.includes("/admin/rate-cards?") || url.endsWith("/admin/rate-cards?limit=100&offset=0")) return list(rateCards);
    if (url.endsWith("/admin/rate-cards") && init?.method === "POST") {
      if (options.failCreateRate) {
        const message = typeof options.failCreateRate === "string" ? options.failCreateRate : "An active rate card already exists for this lease period and occupancy";
        return json({ error: { message } }, 409);
      }
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      return json({
        ok: true,
        data: {
          id: 99,
          lease_period_id: body.leasePeriodId,
          occupancy_capacity: body.occupancyCapacity,
          rate_code: body.rateCode,
          amount_minor: body.amountMinor,
          currency: body.currency ?? "GHS",
          package_months: body.packageMonths ?? null,
          status: body.status ?? "draft",
          effective_from: body.effectiveFrom ?? null,
          effective_to: body.effectiveTo ?? null,
          notes: body.notes ?? null
        }
      }, 201);
    }
    if (url.endsWith("/admin/rate-cards/1/status") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as { status: string };
      return json({ ok: true, data: { ...rateOne, status: body.status } });
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

  it("shows Lease Periods and Rate Cards tabs alongside existing Setup tabs", async () => {
    renderSetup();
    await screen.findByRole("heading", { name: "Setup" });
    expect(screen.getByRole("tab", { name: "Institutions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Academic Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lease Periods" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rate Cards" })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("tab", { name: "Lease Periods" }));
    await screen.findByText("Academic 2026/27");
    expect(screen.queryByRole("button", { name: /create lease period/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Rate Cards" }));
    await screen.findByText("1 Person");
    expect(screen.queryByRole("button", { name: /create rate card/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows API failure state on load", async () => {
    renderSetup({ failLoad: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load setup data");
  });

  it("shows lease period empty state", async () => {
    renderSetup({ leasePeriods: [], rateCards: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    expect(await screen.findByText(/Create an accommodation period before configuring rate cards/i)).toBeInTheDocument();
  });

  it("renders lease periods with human-readable kind labels", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    expect(await screen.findByText("Academic 2026/27")).toBeInTheDocument();
    expect(screen.getByText("Academic Calendar")).toBeInTheDocument();
    expect(screen.getByText("Calendar Year")).toBeInTheDocument();
    expect(screen.getByText("Short-Term")).toBeInTheDocument();
    expect(screen.getByText("2026/2027 (2026)")).toBeInTheDocument();
    expect(screen.queryByText("academic_calendar")).not.toBeInTheDocument();
  });

  it("creates an Academic Calendar lease period with optional academic session", async () => {
    renderSetup({ leasePeriods: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    await userEvent.click(await screen.findByRole("button", { name: /create lease period/i }));
    await userEvent.selectOptions(screen.getByLabelText("Lease Type"), "academic_calendar");
    await userEvent.type(screen.getByLabelText("Lease Period Code"), "AC-NEW");
    await userEvent.type(screen.getByLabelText("Lease Period Name"), "New Academic");
    await userEvent.type(screen.getByLabelText("Lease Period Start Date"), "2028-09-01");
    await userEvent.type(screen.getByLabelText("Lease Period End Date"), "2029-06-30");
    await userEvent.selectOptions(screen.getByLabelText("Academic Session"), "1");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Lease Period" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/lease-periods") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        kind: "academic_calendar",
        code: "AC-NEW",
        name: "New Academic",
        startsOn: "2028-09-01",
        endsOn: "2029-06-30",
        status: "draft",
        academicSessionId: 1,
        notes: null
      });
    });
  });

  it("creates a Calendar Year lease period without academic session", async () => {
    renderSetup({ leasePeriods: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    await userEvent.click(await screen.findByRole("button", { name: /create lease period/i }));
    await userEvent.selectOptions(screen.getByLabelText("Lease Type"), "calendar_year");
    expect(screen.queryByLabelText("Academic Session")).not.toBeInTheDocument();
    expect(screen.getByText(/Calendar Year periods do not require an Academic Session/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Lease Period Code"), "CY-NEW");
    await userEvent.type(screen.getByLabelText("Lease Period Name"), "CY New");
    await userEvent.type(screen.getByLabelText("Lease Period Start Date"), "2028-01-01");
    await userEvent.type(screen.getByLabelText("Lease Period End Date"), "2028-12-31");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Lease Period" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/lease-periods") && init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        kind: "calendar_year",
        code: "CY-NEW",
        academicSessionId: null
      });
    });
  });

  it("creates a Short-Term lease period without academic session", async () => {
    renderSetup({ leasePeriods: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    await userEvent.click(await screen.findByRole("button", { name: /create lease period/i }));
    await userEvent.selectOptions(screen.getByLabelText("Lease Type"), "short_term");
    expect(screen.queryByLabelText("Academic Session")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Lease Period Code"), "ST-NEW");
    await userEvent.type(screen.getByLabelText("Lease Period Name"), "ST New");
    await userEvent.type(screen.getByLabelText("Lease Period Start Date"), "2028-04-01");
    await userEvent.type(screen.getByLabelText("Lease Period End Date"), "2028-06-30");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Lease Period" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/lease-periods") && init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        kind: "short_term",
        code: "ST-NEW",
        academicSessionId: null
      });
    });
  });

  it("validates lease period dates locally", async () => {
    renderSetup({ leasePeriods: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    await userEvent.click(await screen.findByRole("button", { name: /create lease period/i }));
    await userEvent.type(screen.getByLabelText("Lease Period Code"), "BAD");
    await userEvent.type(screen.getByLabelText("Lease Period Name"), "Bad Dates");
    await userEvent.type(screen.getByLabelText("Lease Period Start Date"), "2028-12-31");
    await userEvent.type(screen.getByLabelText("Lease Period End Date"), "2028-01-01");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Lease Period" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Start date must be on or before the end date.");
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/lease-periods") && init?.method === "POST")).toBe(false);
  });

  it("surfaces backend lease period create errors", async () => {
    renderSetup({ leasePeriods: [], failCreateLease: true });
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    await userEvent.click(await screen.findByRole("button", { name: /create lease period/i }));
    await userEvent.type(screen.getByLabelText("Lease Period Code"), "AC-2026");
    await userEvent.type(screen.getByLabelText("Lease Period Name"), "Dup");
    await userEvent.type(screen.getByLabelText("Lease Period Start Date"), "2028-09-01");
    await userEvent.type(screen.getByLabelText("Lease Period End Date"), "2029-06-30");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Lease Period" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Lease period code already exists");
  });

  it("changes lease period status through confirmation", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("tab", { name: "Lease Periods" }));
    await screen.findByText("Academic 2026/27");
    const panel = screen.getByRole("tabpanel", { name: "Lease Periods" });
    await userEvent.click(within(panel).getAllByRole("button", { name: "Activate" })[0]);
    expect(screen.getByText(/Change lease period status from Draft to Active/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/lease-periods/1/status") && init?.method === "PATCH")).toBe(true);
    });
  });

  it("shows rate card empty state when no periods exist", async () => {
    renderSetup({ leasePeriods: [], rateCards: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Rate Cards" }));
    expect(await screen.findByText(/Create a lease period first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create rate card/i })).toBeDisabled();
  });

  it("renders rate cards with occupancy labels and GHS formatting", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("tab", { name: "Rate Cards" }));
    expect(await screen.findByText("1 Person")).toBeInTheDocument();
    expect(screen.getByText("2 Persons")).toBeInTheDocument();
    expect(screen.getByText("4 Persons")).toBeInTheDocument();
    expect(screen.getByText("GHS 9,000.00")).toBeInTheDocument();
    expect(screen.getByText("GHS 6,000.00")).toBeInTheDocument();
    expect(screen.getByText("GHS 3,500.00")).toBeInTheDocument();
    expect(screen.getAllByText("Academic 2026/27").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Academic Calendar").length).toBeGreaterThan(0);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/Changes apply to future agreements only/i)).toBeInTheDocument();
  });

  it("creates a 1-person rate card converting human amount to minor units", async () => {
    renderSetup({ rateCards: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Rate Cards" }));
    await userEvent.click(await screen.findByRole("button", { name: /create rate card/i }));
    expect(screen.getAllByText(/do not change existing resident agreements/i).length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText("Lease Period"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Occupancy"), "1");
    await userEvent.type(screen.getByLabelText("Rate Code"), "NEW-1P");
    await userEvent.type(screen.getByLabelText("Amount per resident"), "9000.00");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Rate Card" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/rate-cards") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        leasePeriodId: 1,
        occupancyCapacity: 1,
        rateCode: "NEW-1P",
        amountMinor: 900000,
        currency: "GHS",
        packageMonths: null,
        status: "draft"
      });
    });
  });

  it("creates 2-person and 4-person rate cards", async () => {
    renderSetup({ rateCards: [] });
    await userEvent.click(await screen.findByRole("tab", { name: "Rate Cards" }));
    await userEvent.click(await screen.findByRole("button", { name: /create rate card/i }));
    await userEvent.selectOptions(screen.getByLabelText("Lease Period"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Occupancy"), "2");
    await userEvent.type(screen.getByLabelText("Rate Code"), "NEW-2P");
    await userEvent.type(screen.getByLabelText("Amount per resident"), "6000");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Rate Card" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/rate-cards") && init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ occupancyCapacity: 2, amountMinor: 600000 });
    });

    await userEvent.click(await screen.findByRole("button", { name: /create rate card/i }));
    await userEvent.selectOptions(screen.getByLabelText("Lease Period"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Occupancy"), "4");
    await userEvent.type(screen.getByLabelText("Rate Code"), "NEW-4P");
    await userEvent.type(screen.getByLabelText("Amount per resident"), "4500.00");
    await userEvent.type(screen.getByLabelText("Package months"), "3");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Rate Card" }).at(-1)!);
    await waitFor(() => {
      const posts = vi.mocked(globalThis.fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/admin/rate-cards") && init?.method === "POST");
      expect(posts.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(String(posts.at(-1)?.[1]?.body))).toMatchObject({
        leasePeriodId: 3,
        occupancyCapacity: 4,
        amountMinor: 450000,
        packageMonths: 3
      });
    });
  });

  it("surfaces rate card validation and API errors", async () => {
    renderSetup({ rateCards: [], failCreateRate: true });
    await userEvent.click(await screen.findByRole("tab", { name: "Rate Cards" }));
    await userEvent.click(await screen.findByRole("button", { name: /create rate card/i }));
    await userEvent.click(screen.getAllByRole("button", { name: "Create Rate Card" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Lease period, rate code and amount are required.");

    await userEvent.selectOptions(screen.getByLabelText("Lease Period"), "1");
    await userEvent.type(screen.getByLabelText("Rate Code"), "DUP");
    await userEvent.type(screen.getByLabelText("Amount per resident"), "1000");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Rate Card" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("An active rate card already exists");
  });

  it("changes rate card status through confirmation with future-agreement messaging", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("tab", { name: "Rate Cards" }));
    await screen.findByText("1 Person");
    const panel = screen.getByRole("tabpanel", { name: "Rate Cards" });
    await userEvent.click(within(panel).getAllByRole("button", { name: "Activate" })[0]);
    expect(screen.getByText(/do not rewrite existing resident agreements/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/rate-cards/1/status") && init?.method === "PATCH")).toBe(true);
    });
  });
});
