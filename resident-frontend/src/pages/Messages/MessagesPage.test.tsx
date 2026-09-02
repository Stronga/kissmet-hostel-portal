import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const messages = [
  { id: 1, subject: "Room inspection", body: "Maintenance will inspect your previous room allocation.", status: "unread", sent_at: "2026-09-02T08:00:00.000Z", delivered_at: "2026-09-02T08:01:00.000Z", read_at: null, sender_label: "Kissmet Hostel", message_status: "sent" },
  { id: 2, subject: "Accounts note", body: "Please visit the accounts office.", status: "read", sent_at: "2026-09-01T08:00:00.000Z", delivered_at: "2026-09-01T08:01:00.000Z", read_at: "2026-09-01T09:00:00.000Z", sender_label: "Kissmet Hostel", message_status: "partially_failed" }
];

function mockMessages(options: { failList?: boolean; failDetail?: boolean; data?: Array<Record<string, unknown>> } = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let current = [...(options.data ?? messages)];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/messages") && method === "GET") {
      if (options.failList) return json({ error: "Messages unavailable" }, 500);
      return json({ ok: true, data: current });
    }
    if (url.includes("/resident/me/messages/") && url.endsWith("/read") && method === "POST") {
      const parts = url.split("/");
      const id = Number(parts[parts.length - 2]);
      current = current.map((message) => message.id === id ? { ...message, status: "read", read_at: "2026-09-02T09:00:00.000Z" } : message);
      return json({ ok: true, data: current.find((message) => message.id === id) });
    }
    if (url.includes("/resident/me/messages/")) {
      if (options.failDetail) return json({ error: "Message not found" }, 404);
      const parts = url.split("/");
      const id = Number(parts[parts.length - 1]);
      const row = current.find((message) => message.id === id);
      return row ? json({ ok: true, data: row }) : json({ error: "Message not found" }, 404);
    }
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return calls;
}

describe("resident messages", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("protects /messages", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/messages"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading, retryable error, and empty inbox states", async () => {
    seedResidentToken();
    mockMessages({ failList: true });
    render(renderResidentApp(["/messages"]));

    expect((await screen.findAllByText("Messages unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    vi.unstubAllGlobals();
    mockMessages({ data: [] });
    render(renderResidentApp(["/messages"]));
    expect(await screen.findByText("You don't have any messages yet.")).toBeInTheDocument();
  });

  it("shows delivered messages chronologically and keeps unread counts real", async () => {
    seedResidentToken();
    const calls = mockMessages();
    render(renderResidentApp(["/messages"]));

    expect(await screen.findByText("1 unread private message.")).toBeInTheDocument();
    const inbox = screen.getByLabelText("Message inbox");
    const buttons = within(inbox).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Room inspection");
    expect(buttons[1]).toHaveTextContent("Accounts note");
    expect(within(buttons[0]).getByText("Unread")).toBeInTheDocument();
    expect(within(buttons[1]).getByText("Read")).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/admin/messages"))).toBe(false);
  });

  it("loads detail and marks only the selected resident delivery read", async () => {
    seedResidentToken();
    const calls = mockMessages();
    render(renderResidentApp(["/messages"]));

    await userEvent.click(await screen.findByRole("button", { name: /Room inspection/i }));
    expect(await screen.findByText("Private messages delivered to your resident account.")).toBeInTheDocument();
    expect(screen.getAllByText("Maintenance will inspect your previous room allocation.").length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.url.endsWith("/resident/me/messages/1/read") && call.method === "POST")).toHaveLength(1);
    expect(calls.some((call) => call.url.includes("/resident_id") || call.url.includes("/admin/messages"))).toBe(false);
  });

  it("does not mark read messages again and handles hidden detail failure safely", async () => {
    seedResidentToken();
    const calls = mockMessages();
    render(renderResidentApp(["/messages"]));

    await userEvent.click(await screen.findByRole("button", { name: /Accounts note/i }));
    expect(calls.filter((call) => call.url.endsWith("/read"))).toHaveLength(0);

    vi.unstubAllGlobals();
    mockMessages({ failDetail: true });
    render(renderResidentApp(["/messages"]));
    await userEvent.click(await screen.findByRole("button", { name: /Room inspection/i }));
    expect(await screen.findByText("Message not found")).toBeInTheDocument();
  });

  it("uses send-time delivery records and does not expose recipients or target internals", async () => {
    seedResidentToken();
    mockMessages({ data: [{ ...messages[0], other_recipient_name: "Kojo Resident", other_phone: "+233555000000", other_email: "kojo@example.com", target_config_json: "{\"roomId\":1}", room_id: 1, resident_id: 2 }] });
    render(renderResidentApp(["/messages"]));

    expect((await screen.findAllByText("Room inspection")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Maintenance will inspect your previous room allocation.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Kojo|233555000000|kojo@example.com|target_config|room_id|resident_id|recipient/i)).not.toBeInTheDocument();
  });
});
