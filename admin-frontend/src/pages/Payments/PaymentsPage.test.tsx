import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { PaymentsPage } from "./PaymentsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const maintenance = { ...manager, role: "maintenance" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "resident" };
const institution = { id: 1, code: "UG", name: "University of Ghana", status: "active" };
const room = { id: 1, room_code: "ROOM-101", room_name: "Room 101", capacity: 2, gender_policy: "female", status: "available" };
const booking = { id: 100, resident_id: 7, academic_session_id: 1, application_id: 50, booking_number: "KSM-BKG-0100", status: "pending", total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, priced_room_rate_id: 1 };
const attentionBooking = { ...booking, status: "confirmed", payment_attention_required: 1, payment_attention_reason: "Refund reduced verified payments below confirmation threshold" };
const payments = [
  { id: 1, booking_id: 100, resident_id: 7, payment_reference: "KSM-PAY-0001", status: "submitted", amount_minor: 100000, currency: "GHS", method: "mobile_money", paid_at: "2026-08-28T03:37:35.599Z", submitted_at: "2026-08-28T03:37:35.599Z" },
  { id: 2, booking_id: 100, resident_id: 7, payment_reference: "KSM-PAY-0002", status: "verified", amount_minor: 50000, currency: "GHS", method: "cash", verified_at: "2026-08-29T03:37:35.599Z" }
];
const summary = { bookingId: 100, bookingTotalMinor: 250000, verifiedPaidMinor: 50000, balanceMinor: 200000, requiredConfirmationAmountMinor: 125000, remainingToConfirmationMinor: 75000, confirmationRequirementMet: false, bookingStatus: "pending", paymentAttentionRequired: false };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 100, offset: 0 } });
}

function renderPayments(options: { role?: "manager" | "maintenance"; payments?: unknown[]; booking?: unknown; summary?: unknown; failLoad?: boolean; failCreate?: boolean; failVerify?: boolean; failReject?: boolean; failRefund?: boolean; failUpload?: boolean } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "maintenance" ? maintenance : manager });
    if (url.includes("/admin/payments?")) return options.failLoad ? json({ error: { message: "Unable to load payments" } }, 500) : list(options.payments ?? payments);
    if (url.endsWith("/admin/payments/1") && init?.method !== "PATCH") return json({ ok: true, data: payments[0] });
    if (url.endsWith("/admin/payments/2") && init?.method !== "PATCH") return json({ ok: true, data: payments[1] });
    if (url.endsWith("/admin/payments") && init?.method === "POST") return options.failCreate ? json({ error: { message: "Payment would exceed booking total" } }, 409) : json({ ok: true, data: { id: 3, booking_id: 100, resident_id: 7, payment_reference: "KSM-PAY-0003", status: "pending", amount_minor: 125000, currency: "GHS", method: "bank_transfer" } }, 201);
    if (url.endsWith("/admin/payments/1/verify")) return options.failVerify ? json({ error: { message: "Payment would exceed booking total" } }, 400) : json({ ok: true, data: { payment: { ...payments[0], status: "verified", verified_at: "2026-08-30T03:37:35.599Z" }, summary: { ...summary, verifiedPaidMinor: 150000, balanceMinor: 100000, confirmationRequirementMet: true } } });
    if (url.endsWith("/admin/payments/1/reject")) return options.failReject ? json({ error: { message: "Invalid workflow transition" } }, 400) : json({ ok: true, data: { ...payments[0], status: "rejected" } });
    if (url.endsWith("/admin/payments/2/refund")) return options.failRefund ? json({ error: { message: "Invalid workflow transition" } }, 400) : json({ ok: true, data: { payment: { ...payments[1], status: "refunded" }, summary: { ...summary, verifiedPaidMinor: 0, balanceMinor: 250000, paymentAttentionRequired: true } } });
    if (url.endsWith("/admin/payments/1/status")) return json({ ok: true, data: { ...payments[0], status: "cancelled" } });
    if (url.endsWith("/admin/payments/1/slip")) return options.failUpload ? json({ error: { message: "Unsupported payment slip file type" } }, 400) : json({ ok: true, data: { id: 9, document_type: "payment_slip", original_filename: "slip.pdf", status: "uploaded" } }, 201);
    if (url.includes("/admin/bookings?")) return list([options.booking ?? booking]);
    if (url.endsWith("/admin/bookings/100")) return json({ ok: true, data: options.booking ?? booking });
    if (url.endsWith("/admin/bookings/100/payment-summary")) return json({ ok: true, data: options.summary ?? summary });
    if (url.includes("/admin/institutions")) return list([institution]);
    if (url.includes("/admin/rooms?")) return list([room]);
    if (url.endsWith("/admin/residents/7")) return json({ ok: true, data: resident });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><PaymentsPage /></AuthProvider></MemoryRouter>);
}

async function openPayment(index = 0) {
  await waitFor(() => expect(screen.getByText("KSM-PAY-0001")).toBeInTheDocument());
  await userEvent.click(screen.getAllByRole("button", { name: "View" })[index]);
  return screen.findByText("Payment Details");
}

describe("PaymentsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders payments list with separate part-payments, formatted currency, status, and dates", async () => {
    renderPayments();
    expect(await screen.findByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(screen.getByText("KSM-PAY-0001")).toBeInTheDocument();
    expect(screen.getByText("KSM-PAY-0002")).toBeInTheDocument();
    expect(screen.getAllByText("Ama Mensah").length).toBeGreaterThan(1);
    expect(screen.getByText("GHS 1,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("Mobile Money").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("28 Aug 2026, 3:37 AM").length).toBeGreaterThan(0);
  });

  it("renders payment detail with backend summary, threshold, and private slip handling", async () => {
    renderPayments();
    await openPayment();
    expect(screen.getByText("Booking Payment Summary")).toBeInTheDocument();
    expect(screen.getAllByText("GHS 2,500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GHS 500.00").length).toBeGreaterThan(0);
    expect(screen.getByText("GHS 2,000.00")).toBeInTheDocument();
    expect(screen.getByText("GHS 1,250.00")).toBeInTheDocument();
    expect(screen.getByText("Requirement met")).toBeInTheDocument();
    expect(screen.getByText(/private R2 objects/)).toBeInTheDocument();
    expect(screen.queryByText(/https:\/\/.*r2/)).not.toBeInTheDocument();
  });

  it("creates payments without frontend-generated internal references", async () => {
    renderPayments();
    await userEvent.click(await screen.findByRole("button", { name: /add payment/i }));
    await userEvent.selectOptions(screen.getByLabelText("Payment booking"), "100");
    await userEvent.type(screen.getByLabelText("Payment amount"), "1250.00");
    await userEvent.selectOptions(screen.getByLabelText("Payment method"), "bank_transfer");
    await userEvent.click(screen.getByRole("button", { name: "Create Payment" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/payments") && init?.method === "POST");
      expect(String(post?.[1]?.body)).toContain("\"amountMinor\":125000");
      expect(String(post?.[1]?.body)).not.toContain("payment_reference");
    });
  });

  it("surfaces overpayment rejection from backend", async () => {
    renderPayments({ failCreate: true });
    await userEvent.click(await screen.findByRole("button", { name: /add payment/i }));
    await userEvent.selectOptions(screen.getByLabelText("Payment booking"), "100");
    await userEvent.type(screen.getByLabelText("Payment amount"), "3000.00");
    await userEvent.click(screen.getByRole("button", { name: "Create Payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment would exceed booking total");
  });

  it("verifies payments without auto-confirming bookings", async () => {
    renderPayments();
    await openPayment();
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByText("Outstanding After Verification")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verify Payment" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/payments/1/verify"))).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/bookings/100/status") && init?.method === "PATCH")).toBe(false);
  });

  it("surfaces verification failure", async () => {
    renderPayments({ failVerify: true });
    await openPayment();
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await userEvent.click(screen.getByRole("button", { name: "Verify Payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment would exceed booking total");
  });

  it("supports rejection flow and failure messages", async () => {
    renderPayments({ failReject: true });
    await openPayment();
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.type(screen.getByLabelText("Rejection notes"), "Invalid reference");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid workflow transition");
  });

  it("shows refund behavior and payment attention context", async () => {
    renderPayments({ booking: attentionBooking, summary: { ...summary, paymentAttentionRequired: true } });
    await openPayment(1);
    expect(screen.getByText("Payment attention required")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refund" }));
    expect(screen.getByText(/removes it from the verified payment total/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/payments/2/refund"))).toBe(true));
  });

  it("handles private slip upload failures through backend messages", async () => {
    renderPayments({ failUpload: true });
    await openPayment();
    const file = new File(["bad"], "slip.exe", { type: "application/octet-stream" });
    await userEvent.upload(screen.getByLabelText("Upload slip for KSM-PAY-0001"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported payment slip file type");
  });

  it("hides payment actions for roles without payment management permission and shows API errors", async () => {
    renderPayments({ role: "maintenance" });
    expect(await screen.findByText("KSM-PAY-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add payment/i })).not.toBeInTheDocument();
    await openPayment();
    expect(screen.getByText("No payment management permission.")).toBeInTheDocument();

    vi.restoreAllMocks();
    renderPayments({ failLoad: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load payments");
  });
});
