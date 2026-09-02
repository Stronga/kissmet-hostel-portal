import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const announcements = [
  { id: 1, title: "Water interruption", body: "Water will be off from 8 AM to 10 AM.", audience: "residents", severity: "warning", published_at: "2026-09-01T08:00:00.000Z", expires_at: "2026-09-03T08:00:00.000Z" },
  { id: 2, title: "Hostel meeting", body: "All residents should attend the meeting.", audience: "all", severity: "high_alert", published_at: "2026-09-02T08:00:00.000Z" }
];

function mockAnnouncements(options: { failList?: boolean; failDetail?: boolean; data?: unknown[] } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/announcements")) {
      if (options.failList) return json({ error: "Announcements unavailable" }, 500);
      return json({ ok: true, data: options.data ?? announcements });
    }
    if (url.includes("/resident/me/announcements/")) {
      if (options.failDetail) return json({ error: "Announcement not found" }, 404);
      const parts = url.split("/");
      const id = Number(parts[parts.length - 1]);
      const row = (options.data ?? announcements).find((item) => Number((item as { id: number }).id) === id);
      return row ? json({ ok: true, data: row }) : json({ error: "Announcement not found" }, 404);
    }
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return calls;
}

describe("resident announcements", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("protects /announcements", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/announcements"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading, retryable error, and empty states", async () => {
    seedResidentToken();
    mockAnnouncements({ failList: true });
    render(renderResidentApp(["/announcements"]));

    expect((await screen.findAllByText("Announcements unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    vi.unstubAllGlobals();
    mockAnnouncements({ data: [] });
    render(renderResidentApp(["/announcements"]));
    expect(await screen.findByText("No announcements right now.")).toBeInTheDocument();
  });

  it("shows published resident and all-audience announcements with severity labels", async () => {
    seedResidentToken();
    const calls = mockAnnouncements();
    render(renderResidentApp(["/announcements"]));

    expect((await screen.findAllByText("Water interruption")).length).toBeGreaterThan(0);
    expect(screen.getByText("Hostel meeting")).toBeInTheDocument();
    expect(screen.getAllByText("Important").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Urgent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Water will be off from 8 AM to 10 AM.").length).toBeGreaterThan(0);
    expect(calls.some((call) => call.url.includes("/admin/announcements"))).toBe(false);
  });

  it("loads detail through the resident endpoint and fails hidden detail safely", async () => {
    seedResidentToken();
    mockAnnouncements({ failDetail: true });
    render(renderResidentApp(["/announcements"]));

    await userEvent.click(await screen.findByRole("button", { name: /Hostel meeting/i }));
    expect(await screen.findByText("Announcement not found")).toBeInTheDocument();
    const list = screen.getByLabelText("Announcement list");
    expect(within(list).getByText("Water interruption")).toBeInTheDocument();
  });

  it("does not display staff IDs audit metadata or internal targeting", async () => {
    seedResidentToken();
    mockAnnouncements({ data: [{ ...announcements[0], created_by_staff_id: 1, updated_by_staff_id: 2, audit_log_id: 3, target_config_json: "{\"staff\":true}" }] });
    render(renderResidentApp(["/announcements"]));

    expect((await screen.findAllByText("Water interruption")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/created_by_staff_id|updated_by_staff_id|audit|target_config|staff/i)).not.toBeInTheDocument();
  });
});
