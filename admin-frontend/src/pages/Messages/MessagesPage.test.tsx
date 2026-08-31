import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { MessagesPage } from "./MessagesPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", status: "resident" };
const room = { id: 2, room_code: "ROOM-101", room_name: "Room 101", capacity: 2, gender_policy: "female", status: "available" };
const allocation = { id: 1, booking_id: 1, resident_id: 7, academic_session_id: 1, bed_id: 3, status: "active" };
const message = { id: 1, subject: "Payment reminder", body: "Please visit accounts.", target_type: "individual_resident", target_label: "Ama Mensah", status: "draft", channels: ["portal"], recipient_count: 0, sent_by_name: null, sent_at: null, recipients: [] };
const sentMessage = { ...message, status: "sent", channels: ["portal", "sms"], recipient_count: 1, sent_by_name: "Manager", sent_at: "2026-08-28T03:37:35.599Z", recipients: [{ id: 1, recipient_kind: "resident", display_name: "Ama Mensah", resident_code: "KSM-RES-0007", student_id: "UG-100", institution_name: "University of Ghana", sms_eligible: 1, email_eligible: 1, portal_eligible: 1 }] };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 25, offset: 0 } });
}

function renderMessages(role: "manager" | "reception" = "manager", failLoad = false) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: role === "manager" ? manager : reception });
    if (url.includes("/admin/messages?")) return failLoad ? json({ error: { message: "Unable to load messages" } }, 500) : list([message]);
    if (url.endsWith("/admin/residents?limit=100&offset=0")) return list([resident]);
    if (url.endsWith("/admin/allocations?limit=100&offset=0")) return list([allocation]);
    if (url.endsWith("/admin/rooms?limit=100&offset=0")) return list([room]);
    if (url.endsWith("/admin/messages/preview")) return json({ ok: true, data: { targetType: "individual_resident", targetLabel: "Ama Mensah", totalRecipients: 1, smsEligible: 1, emailEligible: 1, portalEligible: 1 } });
    if (url.endsWith("/admin/messages") && init?.method === "POST") return json({ ok: true, data: { ...message, id: 2 } }, 201);
    if (url.endsWith("/admin/messages/1")) return json({ ok: true, data: { ...message, recipients: sentMessage.recipients, recipient_count: 1 } });
    if (url.endsWith("/admin/messages/1/send")) return json({ ok: true, data: sentMessage });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><MessagesPage /></AuthProvider></MemoryRouter>);
}

describe("MessagesPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders messages list and keeps contact details private", async () => {
    renderMessages();
    expect(await screen.findByRole("heading", { name: "Messaging" })).toBeInTheDocument();
    expect(screen.getByText("Payment reminder")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.queryByText("233200000000")).not.toBeInTheDocument();
  });

  it("previews recipients and creates a draft with explicit SMS only when selected", async () => {
    renderMessages();
    await userEvent.click(await screen.findByRole("button", { name: "New Message" }));
    await userEvent.type(screen.getByLabelText("Subject"), "Payment reminder");
    await userEvent.type(screen.getByLabelText("Body"), "Please visit accounts.");
    await userEvent.click(screen.getByText(/KSM-RES-0007/));
    await userEvent.click(screen.getByLabelText("SMS"));
    await userEvent.click(screen.getByRole("button", { name: "Preview Recipients" }));
    expect(await screen.findByText("SMS eligible: 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create Draft" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/messages") && init?.method === "POST");
      expect(String(post?.[1]?.body)).toContain("\"channels\":[\"portal\",\"sms\"]");
      expect(String(post?.[1]?.body)).not.toContain("phone");
    });
  });

  it("sends a draft only after confirmation with an idempotency key", async () => {
    renderMessages();
    await userEvent.click((await screen.findAllByRole("button", { name: "View" }))[0]);
    await screen.findByText("Please visit accounts.");
    await userEvent.click(screen.getByRole("button", { name: "Send Draft" }));
    expect(screen.getByText("Send Message?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send Message" }));
    await waitFor(() => {
      const send = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).endsWith("/admin/messages/1/send"));
      expect(String(send?.[1]?.body)).toContain("admin-ui-message-send-1");
    });
  });

  it("disables external channels for roles without external delivery permission", async () => {
    renderMessages("reception");
    await userEvent.click(await screen.findByRole("button", { name: "New Message" }));
    expect(screen.getByLabelText("SMS")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("shows API error state", async () => {
    renderMessages("manager", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load messages");
  });
});
