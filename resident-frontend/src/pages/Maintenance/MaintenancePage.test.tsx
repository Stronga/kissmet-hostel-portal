import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const requests = [
  { id: 1, request_number: "KSM-MNT-0001", category: "plumbing", priority: "urgent", status: "open", title: "Leaking sink", description: "Pipe leak", opened_at: "2026-09-01T00:00:00.000Z", room_code: "A101", room_name: "North Room", bed_code: "A101-B2", bed_label: "Bed 2" },
  { id: 2, request_number: "KSM-MNT-0002", category: "electrical", priority: "high", status: "assigned", title: "Socket fault", assigned_at: "2026-09-01T12:00:00.000Z" },
  { id: 3, request_number: "KSM-MNT-0003", category: "cleaning", priority: "normal", status: "in_progress", title: "Bathroom cleaning", started_at: "2026-09-02T12:00:00.000Z" },
  { id: 4, request_number: "KSM-MNT-0004", category: "furniture", priority: "low", status: "resolved", title: "Chair fixed", resolved_at: "2026-09-03T12:00:00.000Z", room_code: "B202", bed_code: "B202-B1", bed_label: "Bed 1" },
  { id: 5, request_number: "KSM-MNT-0005", category: "security", priority: "normal", status: "closed", title: "Door lock", closed_at: "2026-09-04T12:00:00.000Z" },
  { id: 6, request_number: "KSM-MNT-0006", category: "other", priority: "normal", status: "cancelled", title: "Cancelled request" },
  { id: 7, request_number: "KSM-MNT-0007", category: "other", priority: "normal", status: "archived", title: "Archived request" }
];

interface MockState {
  requests?: unknown[];
  failList?: boolean;
  failCreate?: boolean;
}

function mockMaintenance(state: MockState = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let current = [...(state.requests ?? [])];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method, body });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/maintenance") && method === "GET") {
      if (state.failList) return json({ error: "Maintenance unavailable" }, 500);
      return json({ ok: true, data: current });
    }
    if (url.endsWith("/resident/me/maintenance") && method === "POST") {
      if (state.failCreate) return json({ error: "Unable to create maintenance request" }, 400);
      current = [{ id: 9, request_number: "KSM-MNT-0009", status: "open", opened_at: "2026-09-02T00:00:00.000Z", room_code: "A101", bed_code: "A101-B2", bed_label: "Bed 2", ...body }, ...current];
      return json({ ok: true, data: current[0] }, 201);
    }
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return calls;
}

describe("resident maintenance", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("protects /maintenance", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/maintenance"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading and retryable error states", async () => {
    seedResidentToken();
    mockMaintenance({ failList: true });
    render(renderResidentApp(["/maintenance"]));

    expect((await screen.findAllByText("Maintenance unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows empty active and history states", async () => {
    seedResidentToken();
    mockMaintenance();
    render(renderResidentApp(["/maintenance"]));

    expect(await screen.findByText("No active requests")).toBeInTheDocument();
    expect(screen.getByText("No maintenance history")).toBeInTheDocument();
  });

  it("creates a request with backend-generated number and no ownership fields", async () => {
    seedResidentToken();
    const calls = mockMaintenance();
    render(renderResidentApp(["/maintenance"]));

    await userEvent.type(await screen.findByLabelText("Issue title"), "Broken tap");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "plumbing");
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "urgent");
    await userEvent.type(screen.getByLabelText("Description"), "Water is leaking under the sink.");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("Maintenance request KSM-MNT-0009 created.")).toBeInTheDocument();
    expect(screen.getByText("KSM-MNT-0009")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    const create = calls.find((call) => call.url.endsWith("/resident/me/maintenance") && call.method === "POST");
    expect(create?.body).toMatchObject({ title: "Broken tap", category: "plumbing", priority: "urgent", description: "Water is leaking under the sink." });
    expect(JSON.stringify(create?.body)).not.toMatch(/resident_id|user_id|room_id|bed_id|allocation_id|request_number|status|assigned_staff/i);
    expect(calls.some((call) => call.url.includes("/admin/maintenance"))).toBe(false);
  });

  it("validates required title and handles backend failures", async () => {
    seedResidentToken();
    const calls = mockMaintenance({ failCreate: true });
    render(renderResidentApp(["/maintenance"]));

    await screen.findByText("No active requests");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Issue title is required.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Issue title"), "Broken window");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Unable to create maintenance request")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("prevents duplicate submissions while a request is in flight", async () => {
    seedResidentToken();
    let release!: () => void;
    const pending = new Promise<Response>((resolve) => { release = () => resolve(json({ ok: true, data: { id: 9, request_number: "KSM-MNT-0009", status: "open", title: "Broken tap", category: "plumbing", priority: "normal" } }, 201)); });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me/maintenance") && (init?.method ?? "GET") === "POST") {
        calls.push(url);
        return pending;
      }
      if (url.endsWith("/resident/me/maintenance")) return json({ ok: true, data: [] });
      return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
    }));
    render(renderResidentApp(["/maintenance"]));

    await userEvent.type(await screen.findByLabelText("Issue title"), "Broken tap");
    const button = screen.getByRole("button", { name: "Submit request" });
    await userEvent.click(button);
    await userEvent.click(button);
    release();
    expect(await screen.findByText("Maintenance request KSM-MNT-0009 created.")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("separates active and historical statuses with safe fields", async () => {
    seedResidentToken();
    mockMaintenance({ requests });
    render(renderResidentApp(["/maintenance"]));

    const active = (await screen.findByRole("heading", { name: "Active requests" })).closest("section")!;
    expect(within(active).getByText("KSM-MNT-0001")).toBeInTheDocument();
    expect(within(active).getAllByText("Assigned").length).toBeGreaterThan(0);
    expect(within(active).getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(within(active).queryByText("KSM-MNT-0004")).not.toBeInTheDocument();

    const history = screen.getByRole("heading", { name: "Request history" }).closest("section")!;
    expect(within(history).getAllByText("Resolved").length).toBeGreaterThan(0);
    expect(within(history).getAllByText("Closed").length).toBeGreaterThan(0);
    expect(within(history).getByText("Cancelled")).toBeInTheDocument();
    expect(within(history).getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByText(/resident_id|room_id|bed_id|assigned_to_staff_id|internal notes/i)).not.toBeInTheDocument();
  });

  it("shows room and bed labels from request history, not current allocation", async () => {
    seedResidentToken();
    mockMaintenance({ requests });
    render(renderResidentApp(["/maintenance"]));

    expect(await screen.findByText("A101 - North Room / Bed 2 (A101-B2)")).toBeInTheDocument();
    expect(screen.getByText("B202 / Bed 1 (B202-B1)")).toBeInTheDocument();
    expect(screen.getAllByText("General hostel issue").length).toBeGreaterThan(0);
  });

  it("does not expose staff workflow mutation actions", async () => {
    seedResidentToken();
    mockMaintenance({ requests });
    render(renderResidentApp(["/maintenance"]));

    await screen.findByText("KSM-MNT-0001");
    expect(screen.queryByRole("button", { name: /assign|start|resolve|close|archive|cancel/i })).not.toBeInTheDocument();
  });

  it("links from My Room report action without creating a request automatically", async () => {
    seedResidentToken();
    const allocation = { status: "active", starts_on: "2026-09-01T00:00:00.000Z", room_code: "A101", room_name: "North Room", bed_code: "A101-B2", label: "Bed 2", academic_session_name: "2026/2027", booking_number: "KSM-BKG-0001" };
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body });
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me/allocation")) return json({ ok: true, data: allocation });
      if (url.endsWith("/resident/me/allocations")) return json({ ok: true, data: [allocation] });
      if (url.endsWith("/resident/me/bookings")) return json({ ok: true, data: [] });
      if (url.endsWith("/resident/me/maintenance")) return json({ ok: true, data: [] });
      return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
    }));
    render(renderResidentApp(["/room"]));

    await userEvent.click(await screen.findByRole("link", { name: "Report an issue" }));
    expect(await screen.findByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
});
