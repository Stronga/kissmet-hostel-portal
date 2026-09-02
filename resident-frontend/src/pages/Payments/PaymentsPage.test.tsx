import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const summary = {
  bookingId: 1,
  bookingNumber: "KSM-BKG-0001",
  bookingStatus: "pending",
  bookingTotalMinor: 250000,
  verifiedTotalMinor: 100000,
  outstandingMinor: 150000,
  submittedTotalMinor: 50000,
  pendingTotalMinor: 25000,
  refundedTotalMinor: 30000,
  requiredConfirmationAmountMinor: 250000,
  remainingToConfirmationMinor: 150000,
  confirmationRequirementMet: false,
  currency: "GHS",
  paymentAttentionRequired: false
};

const payments = [
  { id: 1, booking_id: 1, payment_reference: "KSM-PAY-0001", status: "verified", amount_minor: 100000, currency: "GHS", method: "mobile_money", created_at: "2026-08-28T03:37:35.599Z", submitted_at: "2026-08-29T03:37:35.599Z", verified_at: "2026-08-30T03:37:35.599Z", slip_filename: "verified.pdf" },
  { id: 2, booking_id: 1, payment_reference: "KSM-PAY-0002", status: "submitted", amount_minor: 50000, currency: "GHS", method: "bank_transfer", slip_filename: "submitted.png" },
  { id: 3, booking_id: 1, payment_reference: "KSM-PAY-0003", status: "pending", amount_minor: 25000, currency: "GHS", method: "cash" },
  { id: 4, booking_id: 1, payment_reference: "KSM-PAY-0004", status: "refunded", amount_minor: 30000, currency: "GHS", method: "card" }
];

const receipts = [
  { id: 1, receipt_number: "KSM-RCP-0001", status: "issued", issued_at: "2026-08-31T03:37:35.599Z", payment_reference: "KSM-PAY-0001", amount_minor: 100000, currency: "GHS", method: "mobile_money", verified_at: "2026-08-30T03:37:35.599Z" },
  { id: 2, receipt_number: "KSM-RCP-0002", status: "voided", issued_at: "2026-08-31T03:37:35.599Z", payment_reference: "KSM-PAY-0005", amount_minor: 50000, currency: "GHS", method: "cash" }
];

interface MockState {
  summary?: unknown | null;
  payments?: unknown[];
  receipts?: unknown[];
  failSummary?: boolean;
  failCreate?: boolean;
  failSubmit?: boolean;
  failSlip?: boolean;
}

function mockPayments(state: MockState = {}) {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  let currentPayments = [...(state.payments ?? [])];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    requests.push({ url, method, body });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/payments/summary")) {
      if (state.failSummary) return json({ error: "Payments unavailable" }, 500);
      return json({ ok: true, data: state.summary === undefined ? summary : state.summary });
    }
    if (url.endsWith("/resident/me/payments") && method === "GET") return json({ ok: true, data: currentPayments });
    if (url.endsWith("/resident/me/payments") && method === "POST") {
      if (state.failCreate) return json({ error: "Payment would exceed booking total" }, 400);
      currentPayments = [{ id: 9, booking_id: 1, payment_reference: "KSM-PAY-0009", status: "pending", amount_minor: 75000, currency: "GHS", method: "mobile_money" }, ...currentPayments];
      return json({ ok: true, data: currentPayments[0] }, 201);
    }
    if (url.endsWith("/submit")) {
      if (state.failSubmit) return json({ error: "Invalid workflow transition" }, 400);
      currentPayments = currentPayments.map((payment) => ({ ...payment as Record<string, unknown>, status: "submitted" }));
      return json({ ok: true, data: currentPayments[0] });
    }
    if (url.endsWith("/slip")) {
      if (state.failSlip) return json({ error: "Upload failed" }, 400);
      return json({ ok: true, data: { id: 6, document_type: "payment_slip", status: "uploaded", original_filename: "slip.pdf" } }, 201);
    }
    if (url.endsWith("/resident/me/receipts")) return json({ ok: true, data: state.receipts ?? [] });
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return requests;
}

describe("resident payments", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("protects /payments", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/payments"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading and retryable errors", async () => {
    seedResidentToken();
    mockPayments({ failSummary: true });
    render(renderResidentApp(["/payments"]));

    expect((await screen.findAllByText("Payments unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows no booking state without payment creation", async () => {
    seedResidentToken();
    mockPayments({ summary: null });
    render(renderResidentApp(["/payments"]));

    expect(await screen.findByText("No current booking")).toBeInTheDocument();
    expect(screen.getByText("Payment cannot be made until a current booking exists.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create payment record" })).not.toBeInTheDocument();
  });

  it("shows resident-safe summary and part-payment totals", async () => {
    seedResidentToken();
    mockPayments({ payments, receipts });
    render(renderResidentApp(["/payments"]));

    expect(await screen.findByText("KSM-BKG-0001")).toBeInTheDocument();
    expect(screen.getAllByText("GHS 2,500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GHS 1,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GHS 1,500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GHS 500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GHS 300.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/receipt-based balance/i)).not.toBeInTheDocument();
  });

  it("creates payment with backend-generated reference and no resident-owned identifiers", async () => {
    seedResidentToken();
    const requests = mockPayments({ payments: [] });
    render(renderResidentApp(["/payments"]));

    await screen.findByText("KSM-BKG-0001");
    await userEvent.type(screen.getByLabelText("Amount in GHS"), "750");
    await userEvent.selectOptions(screen.getByLabelText("Payment method"), "mobile_money");
    await userEvent.click(screen.getByRole("button", { name: "Create payment record" }));

    expect(await screen.findByText("KSM-PAY-0009")).toBeInTheDocument();
    const create = requests.find((request) => request.url.endsWith("/resident/me/payments") && request.method === "POST");
    expect(create?.body).toMatchObject({ bookingId: 1, amountMinor: 75000, currency: "GHS", method: "mobile_money" });
    expect(JSON.stringify(create?.body)).not.toMatch(/resident_id|payment_reference|status/);
    expect(requests.some((request) => request.url.includes("/admin/payments"))).toBe(false);
  });

  it("blocks invalid and oversized payment amounts and handles backend creation errors", async () => {
    seedResidentToken();
    const requests = mockPayments({ failCreate: true });
    render(renderResidentApp(["/payments"]));

    await screen.findByText("KSM-BKG-0001");
    await userEvent.type(screen.getByLabelText("Amount in GHS"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Create payment record" }));
    expect(await screen.findByText("Enter an amount greater than zero.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Amount in GHS"));
    await userEvent.type(screen.getByLabelText("Amount in GHS"), "2000");
    await userEvent.click(screen.getByRole("button", { name: "Create payment record" }));
    expect(await screen.findByText("Payment amount cannot exceed the outstanding balance.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Amount in GHS"));
    await userEvent.type(screen.getByLabelText("Amount in GHS"), "750");
    await userEvent.click(screen.getByRole("button", { name: "Create payment record" }));
    expect(await screen.findByText("Payment would exceed booking total")).toBeInTheDocument();
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  it("uploads private payment slip with FormData and does not expose storage URLs", async () => {
    seedResidentToken();
    const requests = mockPayments({ payments: [payments[2]] });
    render(renderResidentApp(["/payments"]));

    const paymentCard = (await screen.findByText("KSM-PAY-0003")).closest("div[class*='rounded-token']") as HTMLElement;
    await userEvent.upload(within(paymentCard).getByLabelText("Upload slip"), new File(["slip"], "slip.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("Payment slip uploaded.")).toBeInTheDocument();
    const upload = requests.find((request) => request.url.endsWith("/resident/me/payments/3/slip"));
    expect(upload?.method).toBe("POST");
    expect(upload?.body).toBeInstanceOf(FormData);
    expect(screen.queryByText(/r2|bucket|payment-slips|http/i)).not.toBeInTheDocument();
  });

  it("handles slip validation and upload failure", async () => {
    seedResidentToken();
    mockPayments({ payments: [payments[2]], failSlip: true });
    render(renderResidentApp(["/payments"]));

    const paymentCard = (await screen.findByText("KSM-PAY-0003")).closest("div[class*='rounded-token']") as HTMLElement;
    await userEvent.upload(within(paymentCard).getByLabelText("Upload slip"), new File(["bad"], "bad.txt", { type: "text/plain" }), { applyAccept: false });
    expect(await screen.findByText("Choose a PDF, JPEG, PNG, or WebP file.")).toBeInTheDocument();

    await userEvent.upload(within(paymentCard).getByLabelText("Upload slip"), new File(["slip"], "slip.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
  });

  it("submits pending payment after confirmation without showing verified", async () => {
    seedResidentToken();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const requests = mockPayments({ payments: [payments[2]] });
    render(renderResidentApp(["/payments"]));

    await userEvent.click(await screen.findByRole("button", { name: "Submit for verification" }));
    expect(await screen.findByText("Payment submitted for verification.")).toBeInTheDocument();
    expect(screen.getByText("Awaiting verification")).toBeInTheDocument();
    expect(screen.queryByText("Payment verified.")).not.toBeInTheDocument();
    expect(requests.filter((request) => request.url.endsWith("/resident/me/payments/3/submit"))).toHaveLength(1);
  });

  it("shows submitted verified rejected refunded cancelled and archived status labels", async () => {
    seedResidentToken();
    mockPayments({
      payments: [
        ...payments,
        { id: 5, booking_id: 1, payment_reference: "KSM-PAY-0005", status: "rejected", amount_minor: 10000, currency: "GHS", method: "other" },
        { id: 6, booking_id: 1, payment_reference: "KSM-PAY-0006", status: "cancelled", amount_minor: 10000, currency: "GHS", method: "cash" },
        { id: 7, booking_id: 1, payment_reference: "KSM-PAY-0007", status: "archived", amount_minor: 10000, currency: "GHS", method: "cash" }
      ]
    });
    render(renderResidentApp(["/payments"]));

    expect(await screen.findByText("KSM-PAY-0001")).toBeInTheDocument();
    expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getAllByText("Refunded").length).toBeGreaterThan(0);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("shows confirmed booking payment attention as valid", async () => {
    seedResidentToken();
    mockPayments({ summary: { ...summary, bookingStatus: "confirmed", paymentAttentionRequired: true, paymentAttentionReason: "Refund reduced verified payments below confirmation threshold" } });
    render(renderResidentApp(["/payments"]));

    expect(await screen.findByText("Payment attention required")).toBeInTheDocument();
    expect(screen.getByText("Refund reduced verified payments below confirmation threshold")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("displays issued and voided receipts without issue or void actions", async () => {
    seedResidentToken();
    const requests = mockPayments({ receipts });
    render(renderResidentApp(["/payments"]));

    expect(await screen.findByText("KSM-RCP-0001")).toBeInTheDocument();
    expect(screen.getByText("KSM-RCP-0002")).toBeInTheDocument();
    expect(screen.getByText("Issued")).toBeInTheDocument();
    expect(screen.getByText("Voided")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /issue|void/i })).not.toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/admin/receipts"))).toBe(false);
  });
});
