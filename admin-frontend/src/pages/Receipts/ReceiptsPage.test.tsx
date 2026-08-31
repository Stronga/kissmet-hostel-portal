import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { ReceiptsPage } from "./ReceiptsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "resident" };
const booking = { id: 100, resident_id: 7, academic_session_id: 1, application_id: 50, booking_number: "KSM-BKG-0100", status: "confirmed", total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, priced_room_rate_id: 1 };
const payments = [
  { id: 1, booking_id: 100, resident_id: 7, payment_reference: "KSM-PAY-0001", status: "verified", amount_minor: 100000, currency: "GHS", method: "mobile_money", paid_at: "2026-08-28T03:37:35.599Z", verified_at: "2026-08-29T03:37:35.599Z" },
  { id: 2, booking_id: 100, resident_id: 7, payment_reference: "KSM-PAY-0002", status: "verified", amount_minor: 150000, currency: "GHS", method: "cash", paid_at: "2026-08-30T03:37:35.599Z", verified_at: "2026-08-30T04:37:35.599Z" }
];
const receipts = [
  { id: 1, payment_id: 1, receipt_number: "KSM-RCP-0001", status: "issued", issued_at: "2026-08-29T03:37:35.599Z", issued_by_staff_id: 1 },
  { id: 2, payment_id: 2, receipt_number: "KSM-RCP-0002", status: "voided", issued_at: "2026-08-30T04:37:35.599Z", voided_at: "2026-08-31T04:37:35.599Z", void_reason: "Duplicate print request" }
];
const receiptDetail = { ...receipts[0], payment_reference: "KSM-PAY-0001", amount_minor: 100000, method: "mobile_money", paid_at: payments[0].paid_at, verified_at: payments[0].verified_at, booking_number: "KSM-BKG-0100", total_amount_minor: 250000, resident_code: "KSM-RES-0007", resident_name: "Ama Mensah", student_id: "UG-100", institution_name: "University of Ghana", issuing_staff_name: "Manager" };
const voidedDetail = { ...receipts[1], payment_reference: "KSM-PAY-0002", amount_minor: 150000, method: "cash", paid_at: payments[1].paid_at, verified_at: payments[1].verified_at, booking_number: "KSM-BKG-0100", total_amount_minor: 250000, resident_code: "KSM-RES-0007", resident_name: "Ama Mensah", student_id: "UG-100", institution_name: "University of Ghana", issuing_staff_name: "Manager" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 100, offset: 0 } });
}

function renderReceipts(options: { role?: "manager" | "reception"; receipts?: unknown[]; failLoad?: boolean; failVoid?: boolean; failIssue?: boolean } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "reception" ? reception : manager });
    if (url.includes("/admin/receipts?")) return options.failLoad ? json({ error: { message: "Unable to load receipts" } }, 500) : list(options.receipts ?? receipts);
    if (url.endsWith("/admin/receipts/1")) return json({ ok: true, data: receiptDetail });
    if (url.endsWith("/admin/receipts/2")) return json({ ok: true, data: voidedDetail });
    if (url.endsWith("/admin/receipts/1/void")) return options.failVoid ? json({ error: { message: "Invalid workflow transition" } }, 400) : json({ ok: true, data: { ...receiptDetail, status: "voided", voided_at: "2026-08-31T04:37:35.599Z", void_reason: "Correction" } });
    if (url.endsWith("/admin/payments?limit=100&offset=0")) return list(payments);
    if (url.endsWith("/admin/payments/1") && init?.method !== "POST") return json({ ok: true, data: payments[0] });
    if (url.endsWith("/admin/payments/2") && init?.method !== "POST") return json({ ok: true, data: payments[1] });
    if (url.endsWith("/admin/payments/2/receipt")) return options.failIssue ? json({ error: { message: "Payment already has an active receipt" } }, 409) : json({ ok: true, data: { ...voidedDetail, id: 3, status: "issued", receipt_number: "KSM-RCP-0003" } }, 201);
    if (url.includes("/admin/bookings?")) return list([booking]);
    if (url.endsWith("/admin/bookings/100")) return json({ ok: true, data: booking });
    if (url.endsWith("/admin/residents/7")) return json({ ok: true, data: resident });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><ReceiptsPage /></AuthProvider></MemoryRouter>);
}

async function openReceipt(index = 0) {
  await waitFor(() => expect(screen.getByText("KSM-RCP-0001")).toBeInTheDocument());
  await userEvent.click(screen.getAllByRole("button", { name: "View" })[index]);
  return screen.findByText("Receipt Details");
}

describe("ReceiptsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders receipts list with part-payment receipts, formatted amounts, statuses, and dates", async () => {
    renderReceipts();
    expect(await screen.findByRole("heading", { name: "Receipts" })).toBeInTheDocument();
    expect(screen.getByText("KSM-RCP-0001")).toBeInTheDocument();
    expect(screen.getByText("KSM-RCP-0002")).toBeInTheDocument();
    expect(screen.getByText("KSM-PAY-0001")).toBeInTheDocument();
    expect(screen.getByText("KSM-PAY-0002")).toBeInTheDocument();
    expect(screen.getAllByText("Ama Mensah").length).toBeGreaterThan(1);
    expect(screen.getByText("GHS 1,000.00")).toBeInTheDocument();
    expect(screen.getByText("GHS 1,500.00")).toBeInTheDocument();
    expect(screen.getAllByText("Issued").length).toBeGreaterThan(0);
    expect(screen.getAllByText("29 Aug 2026, 3:37 AM").length).toBeGreaterThan(0);
  });

  it("renders receipt detail with payment, resident, booking, and printable data", async () => {
    renderReceipts();
    await openReceipt();
    expect(screen.getByText("Financial Chain")).toBeInTheDocument();
    expect(screen.getAllByText("KSM-RCP-0001").length).toBeGreaterThan(1);
    expect(screen.getAllByText("KSM-PAY-0001").length).toBeGreaterThan(1);
    expect(screen.getAllByText("KSM-BKG-0100").length).toBeGreaterThan(1);
    expect(screen.getAllByText("KSM-RES-0007").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Mobile Money").length).toBeGreaterThan(0);
    expect(screen.getByText("University of Ghana")).toBeInTheDocument();
    expect(screen.getByText("Date verified/issued")).toBeInTheDocument();
    expect(screen.queryByText(/VAT|signature|bank details/i)).not.toBeInTheDocument();
  });

  it("applies professional A4 print layout styles", async () => {
    renderReceipts();
    await openReceipt();
    const style = document.querySelector(".printable-receipt style")?.textContent ?? "";
    expect(style).toContain("@page { size: A4 portrait; margin: 18mm; }");
    expect(style).toContain("width: 174mm");
    expect(style).toContain("left: 50%");
    expect(style).toContain("page-break-inside: avoid");
  });

  it("does not generate receipt numbers on the frontend when issuing receipts", async () => {
    renderReceipts({ receipts: [receipts[0]] });
    await userEvent.click(await screen.findByRole("button", { name: /issue receipt/i }));
    await userEvent.selectOptions(screen.getByLabelText("Verified payment"), "2");
    await userEvent.click(screen.getAllByRole("button", { name: "Issue Receipt" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).endsWith("/admin/payments/2/receipt"));
      expect(post).toBeTruthy();
      expect(String(post?.[1]?.body ?? "")).not.toContain("receipt_number");
    });
    expect(await screen.findByText("KSM-RCP-0003")).toBeInTheDocument();
  });

  it("surfaces issue failures from duplicate receipt rules", async () => {
    renderReceipts({ receipts: [receipts[0]], failIssue: true });
    await userEvent.click(await screen.findByRole("button", { name: /issue receipt/i }));
    await userEvent.selectOptions(screen.getByLabelText("Verified payment"), "2");
    await userEvent.click(screen.getAllByRole("button", { name: "Issue Receipt" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment already has an active receipt");
  });

  it("voids receipts without deleting them", async () => {
    renderReceipts();
    await openReceipt();
    await userEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(screen.getByText("Void this receipt?")).toBeInTheDocument();
    expect(screen.getByText("The receipt will remain in the financial record and cannot be deleted.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Void reason"), "Correction");
    await userEvent.click(screen.getByRole("button", { name: "Void Receipt" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/receipts/1/void"))).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).includes("/admin/receipts/1") && init?.method === "DELETE")).toBe(false);
    expect(await screen.findByText("VOID")).toBeInTheDocument();
  });

  it("surfaces void failures", async () => {
    renderReceipts({ failVoid: true });
    await openReceipt();
    await userEvent.click(screen.getByRole("button", { name: "Void" }));
    await userEvent.click(screen.getByRole("button", { name: "Void Receipt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid workflow transition");
  });

  it("keeps voided receipts visible and distinguishable", async () => {
    renderReceipts();
    await openReceipt(1);
    expect(screen.getByText("VOID")).toBeInTheDocument();
    expect(screen.getByText("Duplicate print request")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
  });

  it("prints using browser print instead of a fabricated PDF endpoint", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderReceipts();
    await openReceipt();
    await userEvent.click(screen.getByRole("button", { name: /print receipt/i }));
    expect(print).toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).toLowerCase().includes("pdf"))).toBe(false);
  });

  it("hides receipt write actions for roles without receipt write permission", async () => {
    renderReceipts({ role: "reception" });
    expect(await screen.findByText("KSM-RCP-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /issue receipt/i })).not.toBeInTheDocument();
    await openReceipt();
    expect(screen.getByText("No receipt management permission.")).toBeInTheDocument();
  });

  it("shows API error state", async () => {
    renderReceipts({ failLoad: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load receipts");
  });
});
