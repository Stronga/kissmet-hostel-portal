import { FormEvent, useEffect, useState } from "react";
import { approveRefund, cancelRefund, listCreditNotes, listRefunds, payoutRefund, refundReport, rejectRefund } from "../../api/refunds";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { CreditNote, Refund, RefundPayoutMethod, RefundReport, RefundStatus } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";

const statuses: Array<RefundStatus | "all"> = ["all", "requested", "approved", "paid", "rejected", "cancelled"];
const payoutMethods: RefundPayoutMethod[] = ["mobile_money", "bank_transfer", "cash", "card", "other"];
type Action = { kind: "approve" | "reject" | "cancel" | "payout"; refund: Refund } | null;

export function RefundsPage() {
  const { user } = useAuth();
  const canApprove = hasPermission(user?.role, "refund:approve");
  const canRequest = hasPermission(user?.role, "refund:request");
  const canPayout = hasPermission(user?.role, "refund:payout");
  const canReport = hasPermission(user?.role, "report:finance");
  const [statusFilter, setStatusFilter] = useState<RefundStatus | "all">("all");
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [report, setReport] = useState<RefundReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<RefundPayoutMethod>("mobile_money");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load(status = statusFilter) {
    setLoading(true);
    setError(null);
    try {
      const [rows, notes, rep] = await Promise.all([listRefunds(status), listCreditNotes(), canReport ? refundReport() : Promise.resolve(null)]);
      setRefunds(rows);
      setCreditNotes(notes);
      setReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load refunds.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) void load("all"); }, [user?.role]);

  function open(kind: NonNullable<Action>["kind"], refund: Refund) {
    setAction({ kind, refund });
    setNote("");
    setReference("");
    setMethod("mobile_money");
    setActionError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    setSaving(true);
    setActionError(null);
    try {
      if (action.kind === "approve") await approveRefund(action.refund.id, note);
      if (action.kind === "reject") await rejectRefund(action.refund.id, note);
      if (action.kind === "cancel") await cancelRefund(action.refund.id, note);
      if (action.kind === "payout") {
        if (!reference.trim()) { setActionError("Payout reference is required."); return; }
        await payoutRefund(action.refund.id, { method, reference: reference.trim() });
      }
      setAction(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  const titles = { approve: "Approve refund", reject: "Reject refund", cancel: "Cancel refund", payout: "Record payout" } as const;
  const paidTotal = report?.paid.paid_amount_minor ?? 0;
  const openTotal = (report?.byStatus ?? []).filter((r) => r.status === "requested" || r.status === "approved").reduce((sum, r) => sum + Number(r.amount_minor), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Refunds" description="Refund requests need approval by a different staff member before the payout is recorded. Paying out issues a credit note." />
      {report ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard label="Net Verified Payments" value={formatCurrencyMinor(report.net.net_verified_minor)} tone="success" />
          <StatCard label="Refunds Paid" value={formatCurrencyMinor(paidTotal)} />
          <StatCard label="Open Refund Requests" value={formatCurrencyMinor(openTotal)} tone="warning" />
          <StatCard label="Credit Notes Issued" value={report.net.credit_notes_issued ?? 0} />
        </div>
      ) : null}
      <label className="block max-w-xs text-sm font-medium">Status
        <select aria-label="Refund status filter" value={statusFilter} onChange={(e) => { const next = e.target.value as RefundStatus | "all"; setStatusFilter(next); void load(next); }} className="mt-1 w-full rounded-md border border-border px-3 py-2">
          {statuses.map((s) => <option key={s} value={s}>{s === "all" ? "All" : formatStatus(s)}</option>)}
        </select>
      </label>
      {error ? <ErrorState title="Unable to load refunds." message={error} /> : null}
      {loading ? <LoadingState label="Loading refunds..." /> : refunds.length ? (
        <div className="overflow-x-auto rounded-token border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-text-secondary"><th className="px-3 py-2">Refund</th><th className="px-3 py-2">Payment</th><th className="px-3 py-2">Booking</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Payout</th><th className="px-3 py-2">Credit note</th><th className="px-3 py-2">Actions</th></tr></thead>
            <tbody>
              {refunds.map((r) => {
                const mine = user?.staffId != null && Number(r.requested_by_staff_id) === Number(user.staffId);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{r.refund_number}</td>
                    <td className="px-3 py-2">{r.payment_reference}</td>
                    <td className="px-3 py-2">{r.booking_number ?? "—"}</td>
                    <td className="px-3 py-2">{formatCurrencyMinor(r.amount_minor, r.currency)}</td>
                    <td className="px-3 py-2">{formatStatus(r.status)}</td>
                    <td className="px-3 py-2">{r.payout_method ? `${formatStatus(r.payout_method)} · ${r.payout_reference ?? ""}` : "—"}</td>
                    <td className="px-3 py-2">{r.credit_note_number ?? "—"}</td>
                    <td className="space-x-2 px-3 py-2 whitespace-nowrap">
                      {r.status === "requested" && canApprove && !mine ? <><button type="button" onClick={() => open("approve", r)} className="rounded-md border border-border px-2 py-1 font-semibold">Approve</button><button type="button" onClick={() => open("reject", r)} className="rounded-md border border-border px-2 py-1 font-semibold">Reject</button></> : null}
                      {r.status === "requested" && mine ? <span className="text-xs text-text-secondary">Awaiting another approver</span> : null}
                      {r.status === "approved" && canPayout ? <button type="button" onClick={() => open("payout", r)} className="rounded-md bg-primary px-2 py-1 font-semibold text-white">Record payout</button> : null}
                      {(r.status === "requested" || r.status === "approved") && (mine ? canRequest : canApprove) ? <button type="button" onClick={() => open("cancel", r)} className="rounded-md border border-border px-2 py-1 font-semibold">Cancel</button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No refunds" message="Refund requests are created from a verified payment on the Payments page." />}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Credit notes</h2>
        {creditNotes.length ? (
          <div className="overflow-x-auto rounded-token border border-border bg-surface">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-text-secondary"><th className="px-3 py-2">Credit note</th><th className="px-3 py-2">Refund</th><th className="px-3 py-2">Payment</th><th className="px-3 py-2">Receipt</th><th className="px-3 py-2">Resident</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Issued</th></tr></thead>
              <tbody>
                {creditNotes.map((cn) => (
                  <tr key={cn.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{cn.credit_note_number}</td>
                    <td className="px-3 py-2">{cn.refund_number}</td>
                    <td className="px-3 py-2">{cn.payment_reference}</td>
                    <td className="px-3 py-2">{cn.receipt_number ?? "—"}</td>
                    <td className="px-3 py-2">{cn.resident_code}</td>
                    <td className="px-3 py-2">{formatCurrencyMinor(cn.amount_minor, cn.currency)}</td>
                    <td className="px-3 py-2">{new Date(cn.issued_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-text-secondary">No credit notes yet.</p>}
      </section>

      <ConfirmDialog open={Boolean(action)} title={action ? titles[action.kind] : ""} description={action ? `${action.refund.refund_number} · ${formatCurrencyMinor(action.refund.amount_minor, action.refund.currency)} for ${action.refund.payment_reference}` : undefined} onClose={() => { if (!saving) setAction(null); }}>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          {action?.kind === "payout" ? (
            <>
              <label className="block text-sm font-medium">Payout method<select aria-label="Payout method" value={method} onChange={(e) => setMethod(e.target.value as RefundPayoutMethod)} className="mt-1 w-full rounded-md border border-border px-3 py-2">{payoutMethods.map((m) => <option key={m} value={m}>{formatStatus(m)}</option>)}</select></label>
              <label className="block text-sm font-medium">Payout reference<input aria-label="Payout reference" value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" placeholder="Mobile money / bank transaction ID" /></label>
            </>
          ) : (
            <label className="block text-sm font-medium">Note (optional, kept on the refund record)<textarea aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          )}
          {actionError ? <p role="alert" className="text-sm font-medium text-danger">{actionError}</p> : null}
          <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Close</button><button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button></div>
        </form>
      </ConfirmDialog>
    </div>
  );
}
