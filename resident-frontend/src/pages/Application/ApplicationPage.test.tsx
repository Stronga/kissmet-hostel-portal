import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentProfile, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const session = { id: 1, code: "2026", name: "2026 Academic Year", status: "active", starts_on: "2026-01-01", ends_on: "2026-12-31" };
const uploadedDocs = [
  { id: 1, document_type: "student_card", status: "uploaded" },
  { id: 2, document_type: "ghana_card", status: "verified" }
];

interface MockState {
  profile?: Record<string, unknown>;
  documents?: unknown[];
  applications?: unknown[];
  activeSession?: unknown | null;
  failList?: boolean;
  failCreate?: boolean;
  failSubmit?: boolean;
  slowSubmit?: boolean;
}

function mockApplication(state: MockState = {}) {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  let applications = [...(state.applications ?? [])];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let parsed: unknown = undefined;
    if (typeof init?.body === "string") parsed = JSON.parse(init.body);
    requests.push({ url, method, body: parsed });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me") && method === "GET") {
      if (state.failList) return json({ error: "Profile unavailable" }, 500);
      return json({ ok: true, data: state.profile ?? residentProfile });
    }
    if (url.endsWith("/resident/me/documents")) return json({ ok: true, data: state.documents ?? uploadedDocs });
    if (url.endsWith("/resident/me/academic-session")) return json({ ok: true, data: state.activeSession === undefined ? session : state.activeSession });
    if (url.endsWith("/resident/me/applications") && method === "GET") return json({ ok: true, data: applications });
    if (url.endsWith("/resident/me/applications") && method === "POST") {
      if (state.failCreate) return json({ error: "UNIQUE constraint failed" }, 409);
      applications = [{ id: 10, application_number: "KSM-APP-0010", academic_session_id: 1, status: "draft", created_at: "2026-08-28T03:37:35.599Z" }];
      return json({ ok: true, data: applications[0] }, 201);
    }
    if (url.endsWith("/submit") && method === "POST") {
      if (state.failSubmit) return json({ error: "Incomplete application" }, 400);
      const submit = () => {
        applications = applications.map((application) => ({ ...application as Record<string, unknown>, status: "submitted", submitted_at: "2026-08-29T03:37:35.599Z" }));
        return json({ ok: true, data: applications[0] });
      };
      if (state.slowSubmit) return new Promise((resolve) => setTimeout(() => resolve(submit()), 200));
      return submit();
    }
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return requests;
}

describe("resident application workflow", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("protects /application", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/application"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading and retryable errors", async () => {
    seedResidentToken();
    mockApplication({ failList: true });
    render(renderResidentApp(["/application"]));

    expect(await screen.findByText("Application unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows no-application state and starts a draft without caller-owned identifiers", async () => {
    seedResidentToken();
    const requests = mockApplication({ applications: [] });
    render(renderResidentApp(["/application"]));

    expect(await screen.findByText("No application yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start application" }));

    expect(await screen.findByText("KSM-APP-0010")).toBeInTheDocument();
    const create = requests.find((request) => request.url.endsWith("/resident/me/applications") && request.method === "POST");
    expect(create?.body).toEqual({ academicSessionId: 1 });
    expect(JSON.stringify(create?.body)).not.toMatch(/application_number|resident_id|reviewed_by_staff_id/);
    expect(requests.some((request) => request.url.includes("/admin/applications"))).toBe(false);
  });

  it("handles duplicate active application creation failure", async () => {
    seedResidentToken();
    mockApplication({ applications: [], failCreate: true });
    render(renderResidentApp(["/application"]));

    await screen.findByText("No application yet");
    await userEvent.click(screen.getByRole("button", { name: "Start application" }));
    expect(await screen.findByText("UNIQUE constraint failed")).toBeInTheDocument();
  });

  it("displays draft readiness and blocks submit until missing requirements are complete", async () => {
    seedResidentToken();
    mockApplication({
      profile: { ...residentProfile, phone_verified_at: null },
      documents: [{ id: 1, document_type: "student_card", status: "uploaded" }],
      applications: [{ id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "draft", created_at: "2026-08-28T03:37:35.599Z" }]
    });
    render(renderResidentApp(["/application"]));

    expect(await screen.findByText("KSM-APP-0001")).toBeInTheDocument();
    expect(screen.getByText("Verify your phone number before submitting.")).toBeInTheDocument();
    expect(screen.getByText("Upload your Ghana Card.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit application" })).toBeDisabled();
  });

  it("submits a ready draft after confirmation and prevents duplicate submission", async () => {
    seedResidentToken();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const requests = mockApplication({
      slowSubmit: true,
      applications: [{ id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "draft", created_at: "2026-08-28T03:37:35.599Z" }]
    });
    render(renderResidentApp(["/application"]));

    const button = await screen.findByRole("button", { name: "Submit application" });
    expect(button).toBeEnabled();
    const firstClick = userEvent.click(button);
    const secondClick = userEvent.click(button);
    await Promise.all([firstClick, secondClick]);

    await screen.findByText("Application submitted.");
    expect(requests.filter((request) => request.url.endsWith("/resident/me/applications/1/submit") && request.method === "POST")).toHaveLength(1);
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
  });

  it("handles backend submission failure without locally changing status", async () => {
    seedResidentToken();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApplication({
      failSubmit: true,
      applications: [{ id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "draft", created_at: "2026-08-28T03:37:35.599Z" }]
    });
    render(renderResidentApp(["/application"]));

    await userEvent.click(await screen.findByRole("button", { name: "Submit application" }));
    expect(await screen.findByText("Incomplete application")).toBeInTheDocument();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });

  it("shows submitted under review approved rejected and archived lifecycle states safely", async () => {
    seedResidentToken();
    const states = [
      { status: "submitted", text: "Your application has been submitted and is waiting for review." },
      { status: "under_review", text: "Kissmet staff are reviewing your application." },
      { status: "approved", text: "Your application has been approved. You can proceed to booking when a booking is available or created according to the current workflow." },
      { status: "rejected", text: "Documents are unclear." },
      { status: "archived", text: "This application is archived." }
    ];

    for (const state of states) {
      vi.unstubAllGlobals();
      document.body.innerHTML = "";
      mockApplication({
        applications: [{
          id: 1,
          application_number: "KSM-APP-0001",
          academic_session_id: 1,
          status: state.status,
          created_at: "2026-08-28T03:37:35.599Z",
          submitted_at: "2026-08-29T03:37:35.599Z",
          reviewed_at: state.status === "approved" || state.status === "rejected" ? "2026-08-30T03:37:35.599Z" : null,
          decision_notes: state.status === "rejected" ? "Documents are unclear." : null
        }]
      });
      render(renderResidentApp(["/application"]));
      expect(await screen.findByText(state.text)).toBeInTheDocument();
      expect(screen.queryByText(/Room 101|Assigned bed|Paid/i)).not.toBeInTheDocument();
    }
  });

  it("shows neutral rejected fallback when no resident-safe reason exists", async () => {
    seedResidentToken();
    mockApplication({ applications: [{ id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "rejected" }] });
    render(renderResidentApp(["/application"]));

    expect(await screen.findByText("Your application was not approved. Contact hostel management if you need more information.")).toBeInTheDocument();
  });

  it("renders timeline only from real timestamps", async () => {
    seedResidentToken();
    mockApplication({
      applications: [{ id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "approved", created_at: "2026-08-28T03:37:35.599Z", reviewed_at: "2026-08-30T03:37:35.599Z" }]
    });
    render(renderResidentApp(["/application"]));

    const timeline = await screen.findByRole("list", { name: "Application timeline" });
    expect(within(timeline).getByText("Application created")).toBeInTheDocument();
    expect(within(timeline).getByText("Approved")).toBeInTheDocument();
    expect(within(timeline).queryByText("Submitted")).not.toBeInTheDocument();
  });

  it("does not allow starting an application when no active session exists", async () => {
    seedResidentToken();
    mockApplication({ applications: [], activeSession: null });
    render(renderResidentApp(["/application"]));

    expect(await screen.findByText("No active session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start application" })).toBeDisabled();
  });
});
