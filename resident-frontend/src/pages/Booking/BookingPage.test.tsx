import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const approvedApplication = { id: 1, application_number: "KSM-APP-0001", academic_session_id: 1, status: "approved" };
const pendingBooking = {
  id: 10,
  booking_number: "KSM-BKG-0010",
  academic_session_id: 1,
  application_id: 1,
  application_number: "KSM-APP-0001",
  status: "pending",
  total_amount_minor: 250000,
  currency: "GHS",
  booked_at: "2026-08-28T03:37:35.599Z",
  expires_at: "2026-09-05T03:37:35.599Z",
  academic_session_name: "2026 Academic Year",
  academic_session_code: "2026",
  priced_room_code: "R1",
  priced_room_name: "Room 1"
};
const allocation = { id: 1, bed_id: 5, status: "active", starts_on: "2026-08-28T03:37:35.599Z", room_code: "A1", room_name: "Room A1", bed_code: "A1-B1", label: "Bed 1", academic_session_id: 1 };

interface MockState {
  bookings?: unknown[];
  applications?: unknown[];
  allocation?: unknown | null;
  paymentSummary?: unknown | null;
  failBookings?: boolean;
}

function mockBooking(state: MockState = {}) {
  const requests: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/bookings")) {
      if (state.failBookings) return json({ error: "Booking unavailable" }, 500);
      return json({ ok: true, data: state.bookings ?? [] });
    }
    if (url.endsWith("/resident/me/applications")) return json({ ok: true, data: state.applications ?? [] });
    if (url.endsWith("/resident/me/allocation")) return json({ ok: true, data: state.allocation ?? null });
    if (url.endsWith("/resident/me/payments/summary")) return json({ ok: true, data: state.paymentSummary ?? null });
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return requests;
}

describe("resident booking", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("protects /booking", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading and retryable error states", async () => {
    seedResidentToken();
    mockBooking({ failBookings: true });
    render(renderResidentApp(["/booking"]));

    expect((await screen.findAllByText("Booking unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("explains no booking before and after application approval without creating booking", async () => {
    seedResidentToken();
    const requests = mockBooking({ applications: [{ ...approvedApplication, status: "submitted" }] });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("No booking yet")).toBeInTheDocument();
    expect(screen.getByText("Booking comes after application approval. Your current application is not yet approved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create booking|start booking/i })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    mockBooking({ applications: [approvedApplication] });
    render(renderResidentApp(["/booking"]));
    expect(await screen.findByText("Your application is approved. Booking creation and processing are handled according to the current hostel workflow.")).toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/admin/") || request.method !== "GET")).toBe(false);
  });

  it("displays pending booking details from captured booking amount", async () => {
    seedResidentToken();
    mockBooking({ bookings: [pendingBooking], applications: [approvedApplication] });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("KSM-BKG-0010")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GHS 2,500.00").length).toBeGreaterThan(0);
    expect(screen.getByText("2026 Academic Year")).toBeInTheDocument();
    expect(screen.getByText("KSM-APP-0001")).toBeInTheDocument();
    expect(screen.getByText("R1 - Room 1")).toBeInTheDocument();
    expect(screen.getByText(/not recalculated from current room rates/i)).toBeInTheDocument();
    expect(screen.queryByText(/priced_room_rate_id|resident_id|application_id/i)).not.toBeInTheDocument();
  });

  it("does not label priced room as actual room assignment", async () => {
    seedResidentToken();
    mockBooking({ bookings: [pendingBooking] });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("Room used for booking price")).toBeInTheDocument();
    expect(screen.getByText("No room or bed assigned")).toBeInTheDocument();
    expect(screen.queryByText("Assigned room")).not.toBeInTheDocument();
  });

  it("shows confirmed booking without assuming allocation", async () => {
    seedResidentToken();
    mockBooking({ bookings: [{ ...pendingBooking, status: "confirmed" }] });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("Waiting for room assignment")).toBeInTheDocument();
    expect(screen.getByText("A confirmed booking does not mean a bed has been allocated.")).toBeInTheDocument();
  });

  it("shows active allocation separately when present", async () => {
    seedResidentToken();
    mockBooking({ bookings: [{ ...pendingBooking, status: "confirmed" }], allocation });
    render(renderResidentApp(["/booking"]));

    expect((await screen.findAllByText("View My Room")).length).toBeGreaterThan(0);
    expect(screen.getByText("A1 - Room A1")).toBeInTheDocument();
    expect(screen.getByText("Bed 1")).toBeInTheDocument();
  });

  it("shows payment stage without fake verified totals or admin payment calls", async () => {
    seedResidentToken();
    const requests = mockBooking({
      bookings: [pendingBooking],
      paymentSummary: {
        bookingId: 10,
        bookingNumber: "KSM-BKG-0010",
        bookingStatus: "pending",
        bookingTotalMinor: 250000,
        verifiedTotalMinor: 100000,
        outstandingMinor: 150000,
        submittedTotalMinor: 50000,
        pendingTotalMinor: 0,
        refundedTotalMinor: 0,
        requiredConfirmationAmountMinor: 250000,
        remainingToConfirmationMinor: 150000,
        confirmationRequirementMet: false,
        currency: "GHS",
        paymentAttentionRequired: false
      }
    });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("Payment stage")).toBeInTheDocument();
    expect(screen.getByText("GHS 1,000.00")).toBeInTheDocument();
    expect(screen.getByText("GHS 1,500.00")).toBeInTheDocument();
    expect(screen.getByText(/Meeting the payment threshold does not confirm the booking automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/Verified payment.*GHS 0.00/i)).not.toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/admin/payments"))).toBe(false);
  });

  it("shows payment attention even for confirmed bookings", async () => {
    seedResidentToken();
    mockBooking({ bookings: [{ ...pendingBooking, status: "confirmed", payment_attention_required: 1, payment_attention_reason: "Refund reduced verified payments below confirmation threshold" }] });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("Payment attention required")).toBeInTheDocument();
    expect(screen.getByText("Refund reduced verified payments below confirmation threshold")).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
  });

  it("shows cancelled expired completed and archived bookings in history", async () => {
    seedResidentToken();
    mockBooking({
      bookings: [
        { ...pendingBooking, id: 1, booking_number: "KSM-BKG-0001", status: "cancelled", cancelled_at: "2026-09-01T03:37:35.599Z" },
        { ...pendingBooking, id: 2, booking_number: "KSM-BKG-0002", status: "expired" },
        { ...pendingBooking, id: 3, booking_number: "KSM-BKG-0003", status: "completed", completed_at: "2026-10-01T03:37:35.599Z" },
        { ...pendingBooking, id: 4, booking_number: "KSM-BKG-0004", status: "archived" }
      ]
    });
    render(renderResidentApp(["/booking"]));

    expect(await screen.findByText("No booking yet")).toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "Booking history" }).closest("section")!;
    expect(within(history).getByText("KSM-BKG-0001")).toBeInTheDocument();
    expect(within(history).getByText("KSM-BKG-0002")).toBeInTheDocument();
    expect(within(history).getByText("KSM-BKG-0003")).toBeInTheDocument();
    expect(within(history).getByText("KSM-BKG-0004")).toBeInTheDocument();
  });

  it("keeps captured total stable even if mock current rate differs", async () => {
    seedResidentToken();
    mockBooking({ bookings: [{ ...pendingBooking, total_amount_minor: 175000, current_rate_minor: 999999 }] });
    render(renderResidentApp(["/booking"]));

    expect((await screen.findAllByText("GHS 1,750.00")).length).toBeGreaterThan(0);
    expect(screen.queryByText("GHS 9,999.99")).not.toBeInTheDocument();
  });

  it("navigates to payments from pending booking", async () => {
    seedResidentToken();
    mockBooking({ bookings: [pendingBooking] });
    render(renderResidentApp(["/booking"]));

    await screen.findByText("Review payment requirements");
    await userEvent.click(screen.getByRole("link", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Payments" })).toBeInTheDocument();
  });
});
