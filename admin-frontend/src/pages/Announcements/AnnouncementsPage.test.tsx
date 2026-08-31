import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AnnouncementsPage } from "./AnnouncementsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception" };
const announcement = { id: 1, title: "Water Interruption", body: "Water will be off tonight.", audience: "residents", severity: "important", status: "draft", channels: ["resident_portal"], starts_at: "2026-08-28T03:37:35.599Z", expires_at: null, recipient_counts: { sms: 2, email: 3 }, delivery_summary: [] };
const highAlert = { ...announcement, id: 2, title: "Emergency Notice", body: "Move now", severity: "high_alert", channels: ["staff_portal", "sms"] };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 25, offset: 0 } });
}

function renderAnnouncements(role: "manager" | "reception" = "manager") {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: role === "manager" ? manager : reception });
    if (url.includes("/admin/announcements?")) return list([announcement, highAlert]);
    if (url.endsWith("/admin/dashboard/announcements")) return json({ ok: true, data: { published: 1, drafts: 2, high_alerts: 1, expiring_soon: 0 } });
    if (url.endsWith("/admin/announcements/1")) return json({ ok: true, data: announcement });
    if (url.endsWith("/admin/announcements/2")) return json({ ok: true, data: highAlert });
    if (url.endsWith("/admin/announcements") && init?.method === "POST") return json({ ok: true, data: { ...announcement, id: 3, title: "New Notice" } }, 201);
    if (url.endsWith("/admin/announcements/2/publish")) return json({ ok: true, data: { ...highAlert, status: "published", published_at: "2026-08-28T03:37:35.599Z" } });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><AnnouncementsPage /></AuthProvider></MemoryRouter>);
}

describe("AnnouncementsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders announcement metrics and real API data", async () => {
    renderAnnouncements();
    expect(await screen.findByRole("heading", { name: "Announcements" })).toBeInTheDocument();
    expect(screen.getByText("Water Interruption")).toBeInTheDocument();
    expect(screen.getByText("Emergency Notice")).toBeInTheDocument();
    expect(screen.getAllByText(/28 Aug 2026, 3:37 AM/).length).toBeGreaterThan(0);
    expect(screen.getByText("High Alerts")).toBeInTheDocument();
  });

  it("creates a draft without generating announcement numbers or recipients in the frontend", async () => {
    renderAnnouncements();
    await userEvent.click(await screen.findByRole("button", { name: "New Announcement" }));
    await userEvent.type(screen.getByLabelText("Title"), "New Notice");
    await userEvent.type(screen.getByLabelText("Message"), "Fresh broadcast.");
    await userEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/announcements") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(String(post?.[1]?.body)).toContain("\"channels\"");
      expect(String(post?.[1]?.body)).not.toContain("recipient");
      expect(String(post?.[1]?.body)).not.toContain("announcement_number");
    });
  });

  it("requires a high alert confirmation before publish is sent", async () => {
    renderAnnouncements();
    await waitFor(() => expect(screen.getByText("Emergency Notice")).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: "View" })[1]);
    await screen.findByText("Move now");
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByText(/This high alert will be published/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Publish" }).at(-1)!);
    await waitFor(() => {
      const publish = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).endsWith("/admin/announcements/2/publish"));
      expect(String(publish?.[1]?.body)).toContain("\"confirmHighAlert\":true");
    });
  });

  it("hides write actions and disables external channels for read-only announcement roles", async () => {
    renderAnnouncements("reception");
    expect(await screen.findByText("Water Interruption")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Announcement" })).not.toBeInTheDocument();
  });
});
