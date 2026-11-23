import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { RefundsPage } from "./RefundsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts = { ...manager, id: 2, role: "accounts", staffId: 2 };
const base = { payment_id: 5, booking_id: 100, currency: "GHS", payment_reference: "KSM-PAY-0005", booking_number: "KSM-BKG-0100", resident_code: "KSM-RES-0007" };
const refunds = [
  { ...base, id: 1, refund_number: "KSM-RFD-0001", amount_minor: 20000, status: "requested", requested_by_staff_id: 2, requested_at: "2026-11-20T10:00:00Z" },
  { ...base, id: 2, refund_number: "KSM-RFD-0002", amount_minor: 30000, status: "approved", requested_by_staff_id: 2, requested_at: "2026-11-20T10:00:00Z" },
  { ...base, id: 3, refund_number: "KSM-RFD-0003", amount_minor: 10000, status: "paid", requested_by_staff_id: 2, requested_at: "2026-11-19T10:00:00Z", payout_method: "mobile_money", payout_reference: "MM-1", credit_note_number: "KSM-CRN-0001" }
];
const report = { byStatus: [{ status: "requested", count: 1, amount_minor: 20000 }, { status: "approved", count: 1, amount_minor: 30000 }, { status: "paid", count: 1, amount_minor: 10000 }], paid: { paid_count: 1, paid_amount_minor: 10000, partial_paid_amount_minor: 10000 }, byPayoutMethod: [], net: { gross_verified_minor: 260000, refunded_minor: 10000, net_verified_minor: 250000, credit_notes_issued: 1 }, refunds: [] };
const creditNotes = [{ id: 1, credit_note_number: "KSM-CRN-0001", refund_id: 3, payment_id: 5, amount_minor: 10000, currency: "GHS", status: "issued", issued_at: "2026-11-19T12:00:00Z", refund_number: "KSM-RFD-0003", payment_reference: "KSM-PAY-0005", resident_code: "KSM-RES-0007", receipt_number: "KSM-RCP-0005" }];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function renderPage(user = manager, opts: { approveError?: string } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user });
    if (url.includes("/admin/refunds?")) return json({ ok: true, data: refunds });
    if (url.includes("/admin/credit-notes")) return json({ ok: true, data: creditNotes });
    if (url.includes("/admin/reports/refunds")) return json({ ok: true, data: report });
    if (url.endsWith("/admin/refunds/1/approve") && init?.method === "POST") return opts.approveError ? json({ error: { message: opts.approveError } }, 403) : json({ ok: true, data: { ...refunds[0], status: "approved" } });
    if (url.endsWith("/admin/refunds/2/payout") && init?.method === "POST") return json({ ok: true, data: { refund: { ...refunds[1], status: "paid" }, summary: null } });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><RefundsPage /></AuthProvider></MemoryRouter>);
}

describe("RefundsPage", () => {
  it("shows refunds, net/paid/open totals and credit notes", async () => {
    renderPage();
    expect(await screen.findByText("KSM-RFD-0001")).toBeInTheDocument();
    expect(screen.getByText("GHS 2,500.00")).toBeInTheDocument(); // net verified
    expect(screen.getByText("GHS 500.00")).toBeInTheDocument(); // open = 200 + 300
    expect(screen.getAllByText("KSM-CRN-0001").length).toBeGreaterThan(0);
    expect(screen.getByText("KSM-RCP-0005")).toBeInTheDocument();
  });

  it("lets a different user approve and record a payout with method + reference", async () => {
    renderPage();
    const row1 = (await screen.findByText("KSM-RFD-0001")).closest("tr")!;
    await userEvent.click(within(row1).getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/refunds/1/approve") && init?.method === "POST")).toBe(true));

    const row2 = (await screen.findByText("KSM-RFD-0002")).closest("tr")!;
    await userEvent.click(within(row2).getByRole("button", { name: "Record payout" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Payout reference is required.");
    await userEvent.selectOptions(screen.getByLabelText("Payout method"), "bank_transfer");
    await userEvent.type(screen.getByLabelText("Payout reference"), "BT-778");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/refunds/2/payout") && JSON.parse(String((init as RequestInit).body)).reference === "BT-778" && JSON.parse(String((init as RequestInit).body)).method === "bank_transfer")).toBe(true));
  });

  it("hides approve for the requester and shows backend maker/checker errors", async () => {
    renderPage(accounts);
    const row1 = (await screen.findByText("KSM-RFD-0001")).closest("tr")!;
    expect(within(row1).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(row1).getByText("Awaiting another approver")).toBeInTheDocument();
  });

  it("surfaces a 403 self-approval message from the API", async () => {
    renderPage(manager, { approveError: "Refund approval by the requester is forbidden" });
    const row1 = (await screen.findByText("KSM-RFD-0001")).closest("tr")!;
    await userEvent.click(within(row1).getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refund approval by the requester is forbidden");
  });
});
