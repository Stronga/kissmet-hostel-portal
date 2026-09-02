import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const allocation = {
  id: 11,
  status: "active",
  starts_on: "2026-09-01T00:00:00.000Z",
  ends_on: null,
  assigned_at: "2026-08-31T12:00:00.000Z",
  room_code: "A101",
  room_name: "North Room",
  room_gender_policy: "female",
  room_status: "available",
  bed_code: "A101-B2",
  label: "Bed 2",
  academic_session_code: "2026",
  academic_session_name: "2026/2027",
  booking_number: "KSM-BKG-0007"
};

const pricedBooking = {
  id: 7,
  booking_number: "KSM-BKG-0007",
  academic_session_id: 1,
  status: "confirmed",
  total_amount_minor: 250000,
  currency: "GHS",
  priced_room_code: "B202",
  priced_room_name: "Priced Room",
  payment_attention_required: 0
};

interface MockState {
  allocation?: unknown | null;
  allocations?: unknown[];
  bookings?: unknown[];
  failAllocation?: boolean;
}

function mockRoom(state: MockState = {}) {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/allocation")) {
      if (state.failAllocation) return json({ error: "Allocation unavailable" }, 500);
      return json({ ok: true, data: state.allocation ?? null });
    }
    if (url.endsWith("/resident/me/allocations")) return json({ ok: true, data: state.allocations ?? [] });
    if (url.endsWith("/resident/me/bookings")) return json({ ok: true, data: state.bookings ?? [] });
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return requests;
}

describe("resident my room", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("protects /room", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/room"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading and retryable error states", async () => {
    seedResidentToken();
    mockRoom({ failAllocation: true });
    render(renderResidentApp(["/room"]));

    expect((await screen.findAllByText("Allocation unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows no booking no-allocation state without fake room data", async () => {
    seedResidentToken();
    const requests = mockRoom();
    render(renderResidentApp(["/room"]));

    expect(await screen.findByText("No active room assignment")).toBeInTheDocument();
    expect(screen.getByText("Your room has not been assigned yet. A booking is required before room allocation.")).toBeInTheDocument();
    expect(screen.queryByText(/A101|Bed 2|Priced Room/i)).not.toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/admin/") || request.method !== "GET")).toBe(false);
  });

  it("explains pending booking without using priced room as assigned room", async () => {
    seedResidentToken();
    mockRoom({ bookings: [{ ...pricedBooking, status: "pending" }] });
    render(renderResidentApp(["/room"]));

    expect(await screen.findByText("Your booking is still being processed. Room assignment happens after booking confirmation.")).toBeInTheDocument();
    expect(screen.getByText(/The priced room on your booking is not shown as your assigned room/i)).toBeInTheDocument();
    expect(screen.queryByText("B202 - Priced Room")).not.toBeInTheDocument();
  });

  it("explains confirmed booking with no allocation", async () => {
    seedResidentToken();
    mockRoom({ bookings: [pricedBooking] });
    render(renderResidentApp(["/room"]));

    expect(await screen.findByText("Your booking is confirmed. Your room and bed have not been assigned yet.")).toBeInTheDocument();
    expect(screen.queryByText("Your room assignment")).not.toBeInTheDocument();
  });

  it("handles cancelled and expired bookings as no active assignment", async () => {
    seedResidentToken();
    mockRoom({ bookings: [{ ...pricedBooking, status: "expired" }] });
    render(renderResidentApp(["/room"]));

    expect(await screen.findByText("You do not currently have an active room assignment.")).toBeInTheDocument();
  });

  it("displays active room bed session booking and start date from allocation only", async () => {
    seedResidentToken();
    mockRoom({ allocation, allocations: [allocation], bookings: [pricedBooking] });
    render(renderResidentApp(["/room"]));

    expect(await screen.findByText("Your room assignment")).toBeInTheDocument();
    expect(screen.getAllByText("A101 - North Room").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bed 2 (A101-B2)").length).toBeGreaterThan(0);
    expect(screen.getByText("2026/2027")).toBeInTheDocument();
    expect(screen.getAllByText("KSM-BKG-0007").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText("Female occupancy")).toBeInTheDocument();
    expect(screen.queryByText(/resident_id|bed_id|assigned_by_staff_id|staffId|audit/i)).not.toBeInTheDocument();
  });

  it("keeps priced room distinct from assigned room", async () => {
    seedResidentToken();
    mockRoom({ allocation, allocations: [allocation], bookings: [pricedBooking] });
    render(renderResidentApp(["/room"]));

    await screen.findByText("Your room assignment");
    const assignment = screen.getByText("Your room assignment").closest("section") ?? document.body;
    expect(within(assignment as HTMLElement).getAllByText("A101 - North Room").length).toBeGreaterThan(0);
    expect(screen.getByText("B202 - Priced Room")).toBeInTheDocument();
    expect(screen.getByText(/this room and bed come from your active allocation record/i)).toBeInTheDocument();
  });

  it("shows payment attention separately while keeping active allocation visible", async () => {
    seedResidentToken();
    mockRoom({ allocation, allocations: [allocation], bookings: [{ ...pricedBooking, payment_attention_required: 1, payment_attention_reason: "Refund reduced verified payments below confirmation threshold" }] });
    render(renderResidentApp(["/room"]));

    expect((await screen.findAllByText("A101 - North Room")).length).toBeGreaterThan(0);
    expect(screen.getByText("Payment attention required")).toBeInTheDocument();
    expect(screen.getByText("Refund reduced verified payments below confirmation threshold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Payments" })).toHaveAttribute("href", "/payments");
  });

  it("shows previous allocations only in history", async () => {
    seedResidentToken();
    const previous = { ...allocation, id: 10, status: "transferred", room_code: "C303", room_name: "Old Room", bed_code: "C303-B1", label: "Bed 1", starts_on: "2026-08-01T00:00:00.000Z", ends_on: "2026-08-31T00:00:00.000Z" };
    mockRoom({ allocation, allocations: [allocation, previous], bookings: [pricedBooking] });
    render(renderResidentApp(["/room"]));

    expect(await screen.findByText("Your room assignment")).toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "Previous room assignments" }).closest("section")!;
    expect(within(history).getByText("C303 - Old Room")).toBeInTheDocument();
    expect(within(history).getByText("Transferred")).toBeInTheDocument();
    expect(within(history).queryByText("A101 - North Room")).not.toBeInTheDocument();
  });

  it("does not expose allocation mutation or arbitrary resident targeting", async () => {
    seedResidentToken();
    const requests = mockRoom({ allocation, allocations: [allocation], bookings: [pricedBooking] });
    render(renderResidentApp(["/room"]));

    await screen.findByText("Your room assignment");
    expect(screen.queryByRole("button", { name: /choose|change|transfer|end|cancel|check out/i })).not.toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("resident_id") || request.url.includes("/admin/") || request.method !== "GET")).toBe(false);
  });

  it("navigates to booking without duplicating allocation management", async () => {
    seedResidentToken();
    mockRoom({ allocation, allocations: [allocation], bookings: [pricedBooking] });
    render(renderResidentApp(["/room"]));

    await screen.findByText("Your room assignment");
    await userEvent.click(screen.getByRole("link", { name: "View Booking" }));
    expect(await screen.findByRole("heading", { name: "Booking" })).toBeInTheDocument();
  });
});
