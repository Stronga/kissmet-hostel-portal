import { render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { BookingsPage } from "./BookingsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const maintenance = { ...manager, role: "maintenance" };
const institution = { id: 1, code: "ug", name: "University of Ghana", status: "active" };
const session = { id: 1, code: "2026", name: "2026/2027", status: "active" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", status: "applicant" };
const approvedApp = { id: 11, resident_id: 7, academic_session_id: 1, application_number: "KSM-APP-0011", status: "approved" };
const submittedApp = { ...approvedApp, id: 12, application_number: "KSM-APP-0012", status: "submitted" };
const room = { id: 2, room_code: "A1", room_name: "Aster", capacity: 2, gender_policy: "female", status: "available" };
const rate = { id: 5, room_id: 2, academic_session_id: 1, rate_code: "A1-2026", amount_minor: 250000, currency: "GHS", status: "active" };
const booking = { id: 21, resident_id: 7, academic_session_id: 1, application_id: 11, booking_number: "KSM-BKG-0021", status: "pending", total_amount_minor: 250000, currency: "GHS", priced_room_id: 2, priced_room_rate_id: 5, created_at: "2026-08-28T03:37:35.599Z", payment_attention_required: 0 };
const eligibleSummary = { bookingId: 21, bookingTotalMinor: 250000, verifiedPaidMinor: 250000, balanceMinor: 0, requiredConfirmationAmountMinor: 250000, remainingToConfirmationMinor: 0, confirmationRequirementMet: true, bookingStatus: "pending", paymentAttentionRequired: false };
const insufficientSummary = { ...eligibleSummary, verifiedPaidMinor: 50000, balanceMinor: 200000, remainingToConfirmationMinor: 200000, confirmationRequirementMet: false };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 25, offset: 0 } });
}

function renderBookings(options: { role?: "manager" | "maintenance"; bookings?: unknown[]; applications?: unknown[]; paymentSummary?: unknown; patchFails?: boolean; createFails?: boolean } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  const rows = options.bookings ?? [booking];
  const apps = options.applications ?? [approvedApp, submittedApp];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "maintenance" ? maintenance : manager });
    if (url.includes("/admin/bookings?")) return list(rows);
    if (url.endsWith("/admin/bookings/21")) return json({ ok: true, data: rows[0] ?? booking });
    if (url.endsWith("/admin/bookings/21/payment-summary")) return json({ ok: true, data: options.paymentSummary ?? eligibleSummary });
    if (url.endsWith("/admin/bookings/21/status") && init?.method === "PATCH") return options.patchFails ? json({ error: { message: "Payment confirmation requirement not satisfied" } }, 400) : json({ ok: true, data: { ...booking, status: "confirmed" } });
    if (url.endsWith("/admin/bookings") && init?.method === "POST") return options.createFails ? json({ error: { message: "Duplicate active booking" } }, 409) : json({ ok: true, data: { ...booking, id: 22, booking_number: "KSM-BKG-0022" } }, 201);
    if (url.includes("/admin/applications?")) return list(apps);
    if (url.endsWith("/admin/applications/11")) return json({ ok: true, data: approvedApp });
    if (url.endsWith("/admin/residents/7")) return json({ ok: true, data: resident });
    if (url.includes("/admin/institutions")) return list([institution]);
    if (url.includes("/admin/academic-sessions")) return list([session]);
    if (url.includes("/admin/rooms")) return list([room]);
    if (url.includes("/admin/room-rates")) return list([rate]);
    if (url.includes("/admin/availability")) return json({ ok: true, data: [{ room_id: 2, room_code: "A1", room_name: "Aster", capacity: 2, gender_policy: "female", bed_id: 9, bed_code: "A1-A", label: "A", amount_minor: 250000, currency: "GHS" }] });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><BookingsPage /></AuthProvider></MemoryRouter>);
}

async function openDetail() {
  await userEvent.click(await screen.findByRole("button", { name: "View" }));
  return screen.findByText("Booking Details");
}

describe("BookingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders bookings with formatted dates and captured currency amount", async () => {
    renderBookings();
    expect(await screen.findByRole("heading", { name: "Bookings" })).toBeInTheDocument();
    expect(await screen.findByText("KSM-BKG-0021")).toBeInTheDocument();
    expect(screen.getByText("GHS 2,500.00")).toBeInTheDocument();
    expect(screen.getByText("28 Aug 2026, 3:37 AM")).toBeInTheDocument();
    expect(screen.queryByText("2026-08-28T03:37:35.599Z")).not.toBeInTheDocument();
  });

  it("opens booking detail with payment summary and pricing basis", async () => {
    renderBookings();
    await openDetail();
    expect(screen.getByText("A1 - Aster")).toBeInTheDocument();
    expect(screen.getByText("A1-2026")).toBeInTheDocument();
    expect(screen.getByText("Eligible to confirm")).toBeInTheDocument();
    expect(screen.getByText("Bookings never create allocations in this phase")).toBeInTheDocument();
  });

  it("creates a booking from an approved application without generating booking number in frontend", async () => {
    renderBookings();
    await userEvent.click(await screen.findByRole("button", { name: /create booking/i }));
    expect(screen.queryByText("KSM-APP-0012")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Approved application"), "11");
    await waitFor(() => expect(screen.getAllByText(/GHS 2,500.00/).length).toBeGreaterThan(1));
    await userEvent.selectOptions(screen.getByLabelText("Eligible room with active rate"), "2");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Booking" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/bookings") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(String(post?.[1]?.body)).not.toContain("booking_number");
      expect(String(post?.[1]?.body)).not.toContain("KSM-BKG");
    });
  });

  it("does not present confirm when payment threshold is insufficient", async () => {
    renderBookings({ paymentSummary: insufficientSummary });
    await openDetail();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("confirms an eligible pending booking without creating an allocation", async () => {
    renderBookings();
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByText("Payment requirements must be satisfied. Confirming the booking does not allocate a bed automatically.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Confirm" }).at(-1)!);
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/bookings/21/status"))).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/admin/allocations"))).toBe(false);
  });

  it("shows confirmation failure", async () => {
    renderBookings({ patchFails: true });
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Confirm" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment confirmation requirement not satisfied");
  });

  it("shows payment attention", async () => {
    renderBookings({ bookings: [{ ...booking, payment_attention_required: 1, payment_attention_reason: "Refund reduced verified payments below confirmation threshold" }], paymentSummary: { ...eligibleSummary, paymentAttentionRequired: true } });
    await openDetail();
    expect(screen.getByText(/Payment attention required: Refund reduced/)).toBeInTheDocument();
  });

  it("hides write actions for maintenance role", async () => {
    renderBookings({ role: "maintenance" });
    await screen.findByText("KSM-BKG-0021");
    expect(screen.queryByRole("button", { name: /create booking/i })).not.toBeInTheDocument();
    await openDetail();
    expect(screen.getByText(/cannot change booking status/i)).toBeInTheDocument();
  });

  it("hides invalid transitions for completed bookings", async () => {
    renderBookings({ bookings: [{ ...booking, status: "completed" }] });
    await openDetail();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("shows API and creation errors", async () => {
    renderBookings({ createFails: true });
    await userEvent.click(await screen.findByRole("button", { name: /create booking/i }));
    await userEvent.selectOptions(screen.getByLabelText("Approved application"), "11");
    await userEvent.selectOptions(await screen.findByLabelText("Eligible room with active rate"), "2");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Booking" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Duplicate active booking");
  });

  it("shows no eligible approved applications", async () => {
    renderBookings({ applications: [submittedApp] });
    await userEvent.click(await screen.findByRole("button", { name: /create booking/i }));
    expect(within(screen.getByLabelText("Approved application")).queryByText("KSM-APP-0011")).not.toBeInTheDocument();
    expect(screen.getByText("No approved applications are currently eligible for booking creation.")).toBeInTheDocument();
  });
});
