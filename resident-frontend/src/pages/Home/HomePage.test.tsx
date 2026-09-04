import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentUser, seedResidentToken } from "../../testUtils";

const profile = {
  id: 9,
  resident_code: "KSM-RES-0009",
  first_name: "Ama",
  middle_name: null,
  last_name: "Resident",
  status: "applicant",
  phone_verified_at: "2026-08-28T03:37:35.599Z",
  phone: "+233555111222",
  email: "ama@example.com",
  institution_code: "UG",
  institution_name: "University of Ghana",
  student_id: "UG-123"
};

const documentSet = [
  { id: 1, document_type: "student_card", status: "uploaded" },
  { id: 2, document_type: "ghana_card", status: "verified" }
];

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

interface MockState {
  documents?: unknown[];
  applications?: unknown[];
  bookings?: unknown[];
  allocation?: unknown | null;
  paymentSummary?: unknown | null;
  announcements?: unknown[];
  messages?: unknown[];
  failApplications?: boolean;
  failMessages?: boolean;
  failProfile?: boolean;
}

function mockDashboard(state: MockState) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me") && state.failProfile) return json({ error: "Profile unavailable" }, 500);
    if (url.endsWith("/resident/me")) return json({ ok: true, data: profile });
    if (url.endsWith("/resident/me/documents")) return json({ ok: true, data: state.documents ?? [] });
    if (url.endsWith("/resident/me/applications") && state.failApplications) return json({ error: "Application unavailable" }, 500);
    if (url.endsWith("/resident/me/applications")) return json({ ok: true, data: state.applications ?? [] });
    if (url.endsWith("/resident/me/bookings")) return json({ ok: true, data: state.bookings ?? [] });
    if (url.endsWith("/resident/me/allocation")) return json({ ok: true, data: state.allocation ?? null });
    if (url.endsWith("/resident/me/payments/summary")) return json({ ok: true, data: state.paymentSummary ?? null });
    if (url.endsWith("/resident/me/announcements")) return json({ ok: true, data: state.announcements ?? [] });
    if (url.endsWith("/resident/me/messages") && state.failMessages) return json({ error: "Messages unavailable" }, 500);
    if (url.endsWith("/resident/me/messages")) return json({ ok: true, data: state.messages ?? [] });
    return json({ ok: true, data: [] });
  }));
}

describe("resident home dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedResidentToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders authenticated resident identity and journey from real mocked API state", async () => {
    mockDashboard({ documents: documentSet });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Welcome, Ama Resident")).toBeInTheDocument();
    expect(screen.getByText("KSM-RES-0009")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Accommodation journey" })).toBeInTheDocument();
    expect(screen.getByText("Start your hostel application")).toBeInTheDocument();
  });

  it("shows loading and retryable error states", async () => {
    mockDashboard({ failProfile: true });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Profile unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("handles partial dashboard failures without losing profile", async () => {
    mockDashboard({ documents: documentSet, failApplications: true });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Welcome, Ama Resident")).toBeInTheDocument();
    expect(screen.getByText(/Some dashboard sections could not load/i)).toBeInTheDocument();
  });

  it("sets next action for missing documents", async () => {
    mockDashboard({});
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Upload your required documents")).toBeInTheDocument();
  });

  it("sets next action for one missing identity document", async () => {
    mockDashboard({ documents: [{ id: 1, document_type: "student_card", status: "uploaded" }] });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Upload your Ghana Card")).toBeInTheDocument();
  });

  it("sets next action for draft application", async () => {
    mockDashboard({ documents: documentSet, applications: [{ id: 1, application_number: "KSM-APP-0001", status: "draft" }] });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Continue your draft application")).toBeInTheDocument();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });

  it("shows submitted and under-review application states", async () => {
    mockDashboard({ documents: documentSet, applications: [{ id: 2, application_number: "KSM-APP-0002", status: "under_review", submitted_at: "2026-08-28T03:37:35.599Z" }] });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Wait for application review")).toBeInTheDocument();
    expect(screen.getAllByText("Under Review").length).toBeGreaterThan(0);
  });

  it("shows approved application progression before booking", async () => {
    mockDashboard({ documents: documentSet, applications: [{ id: 3, application_number: "KSM-APP-0003", status: "approved" }] });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Continue to booking")).toBeInTheDocument();
  });

  it("shows pending booking and does not treat submitted payment as verified", async () => {
    mockDashboard({
      documents: documentSet,
      applications: [{ id: 3, application_number: "KSM-APP-0003", status: "approved" }],
      bookings: [{ id: 1, booking_number: "KSM-BOOK-0001", status: "pending", total_amount_minor: 120000, currency: "GHS" }],
      paymentSummary: {
        bookingId: 1,
        bookingNumber: "KSM-BOOK-0001",
        bookingStatus: "pending",
        bookingTotalMinor: 120000,
        verifiedTotalMinor: 40000,
        outstandingMinor: 80000,
        submittedTotalMinor: 50000,
        pendingTotalMinor: 0,
        refundedTotalMinor: 0,
        requiredConfirmationAmountMinor: 120000,
        remainingToConfirmationMinor: 80000,
        confirmationRequirementMet: false,
        currency: "GHS",
        paymentAttentionRequired: false
      }
    });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Review your booking and payment requirements")).toBeInTheDocument();
    expect(screen.getAllByText("GHS 1,200.00").length).toBeGreaterThan(0);
    expect(screen.getByText("GHS 400.00")).toBeInTheDocument();
    expect(screen.getByText("GHS 800.00")).toBeInTheDocument();
    expect(screen.queryByText(/Resident-safe payment totals are not exposed/i)).not.toBeInTheDocument();
  });

  it("does not auto-confirm a pending booking when the payment requirement is met", async () => {
    mockDashboard({
      documents: documentSet,
      applications: [{ id: 3, application_number: "KSM-APP-0003", status: "approved" }],
      bookings: [{ id: 1, booking_number: "KSM-BOOK-0001", status: "pending", total_amount_minor: 120000, currency: "GHS" }],
      paymentSummary: {
        bookingId: 1,
        bookingNumber: "KSM-BOOK-0001",
        bookingStatus: "pending",
        bookingTotalMinor: 120000,
        verifiedTotalMinor: 120000,
        outstandingMinor: 0,
        submittedTotalMinor: 0,
        pendingTotalMinor: 0,
        refundedTotalMinor: 0,
        requiredConfirmationAmountMinor: 120000,
        remainingToConfirmationMinor: 0,
        confirmationRequirementMet: true,
        currency: "GHS",
        paymentAttentionRequired: false
      }
    });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Await booking confirmation")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
  });

  it("shows confirmed booking progression as verified-payment-compatible state", async () => {
    mockDashboard({
      documents: documentSet,
      applications: [{ id: 3, application_number: "KSM-APP-0003", status: "approved" }],
      bookings: [{ id: 2, booking_number: "KSM-BOOK-0002", status: "confirmed", total_amount_minor: 120000, currency: "GHS" }]
    });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Wait for room assignment")).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
  });

  it("does not invent a room without active allocation", async () => {
    mockDashboard({ documents: documentSet, applications: [{ id: 3, application_number: "KSM-APP-0003", status: "approved" }], bookings: [{ id: 2, booking_number: "KSM-BOOK-0002", status: "confirmed", total_amount_minor: 120000, currency: "GHS" }] });
    render(renderResidentApp(["/home"]));

    expect((await screen.findAllByText("Room assignment pending")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Room 101/i)).not.toBeInTheDocument();
  });

  it("shows active allocation as assigned state", async () => {
    mockDashboard({
      documents: documentSet,
      applications: [{ id: 3, application_number: "KSM-APP-0003", status: "approved" }],
      bookings: [{ id: 2, booking_number: "KSM-BOOK-0002", status: "confirmed", total_amount_minor: 120000, currency: "GHS" }],
      allocation: { id: 1, bed_id: 5, status: "active", starts_on: "2026-08-28T03:37:35.599Z", room_code: "A1", room_name: "Room A1", bed_code: "A1-B1", label: "Bed 1", academic_session_id: 1 }
    });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("View your room assignment")).toBeInTheDocument();
    expect(screen.getByText("A1 - Room A1")).toBeInTheDocument();
    expect(screen.getByText("Bed 1")).toBeInTheDocument();
  });

  it("shows latest communication from real resident endpoints without changing journey state", async () => {
    mockDashboard({
      documents: documentSet,
      announcements: [{ id: 1, title: "Water update", body: "Water is restored.", severity: "info", published_at: "2026-09-02T08:00:00.000Z" }],
      messages: [{ id: 1, subject: "Accounts note", body: "Please visit accounts.", status: "unread", sent_at: "2026-09-02T09:00:00.000Z" }]
    });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Updates")).toBeInTheDocument();
    expect(screen.getByText("Water update")).toBeInTheDocument();
    expect(screen.getByText("Accounts note")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getByText("Start your hostel application")).toBeInTheDocument();
  });

  it("keeps core dashboard available when communication loading fails", async () => {
    mockDashboard({ documents: documentSet, failMessages: true });
    render(renderResidentApp(["/home"]));

    expect(await screen.findByText("Welcome, Ama Resident")).toBeInTheDocument();
    expect(screen.getByText(/Messages: Messages unavailable/i)).toBeInTheDocument();
  });

  it("links document next action to the real documents page", async () => {
    mockDashboard({});
    render(renderResidentApp(["/home"]));

    await screen.findByText("Upload your required documents");
    await userEvent.click(screen.getByRole("link", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByText("0 of 2 uploaded")).toBeInTheDocument();
  });
});
