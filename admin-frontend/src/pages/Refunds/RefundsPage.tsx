import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { approveRefund, cancelRefund, getRefund, listCreditNotes, listRefunds, payoutRefund, refundReport, rejectRefund } from "../../api/refunds";
import { GuidedWorkflow } from "../../components/workflow/GuidedWorkflow";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<RefundStatus | "all">((searchParams.get("status") ?? "all") as RefundStatus | "all");
  const [focused, setFocused] = useState<Refund | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
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
      const [page, notes, rep] = await Promise.all([listRefunds(status), listCreditNotes(), canReport ? refundReport() : Promise.resolve(null)]);
      setRefunds(page.refunds);
      setCreditNotes(notes);
      setReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load refunds.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) void load(statusFilter); }, [user?.role, statusFilter]);

  useEffect(() => {
    const recordId = Number(searchParams.get("record") ?? 0);
    if (!Number.isInteger(recordId) || recordId <= 0) return;
    let alive = true;
    getRefund(recordId).then((refund) => { if (alive) setFocused(refund); }).catch(() => { if (alive) setRecordError("This record is no longer available."); });
    return () => { alive = false; };
  }, [searchParams]);

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
        <select aria-label="Refund status filter" value={statusFilter} onChange={(e) => { const next = e.target.value as RefundStatus | "all"; setStatusFilter(next); const copy = new URLSearchParams(searchParams); if (next === "all") copy.delete("status"); else copy.set("status", next); setSearchParams(copy); }} className="mt-1 w-full rounded-md border border-border px-3 py-2">
          {statuses.map((s) => <option key={s} value={s}>{s === "all" ? "All" : formatStatus(s)}</option>)}
        </select>
      </label>
      {error ? <ErrorState title="Unable to load refunds." message={error} /> : null}
      {recordError ? <ErrorState title="Record unavailable" message={recordError} /> : null}
      <ConfirmDialog open={Boolean(focused)} title="Refund details" onClose={() => { setFocused(null); const copy = new URLSearchParams(searchParams); copy.delete("record"); setSearchParams(copy); }}>
        {focused ? <div className="space-y-3"><GuidedWorkflow subjectType="refund" subjectId={focused.id} /><p className="text-sm">{focused.refund_number} · {formatCurrencyMinor(focused.amount_minor, focused.currency)} · {formatStatus(focused.status)}</p></div> : null}
      </ConfirmDialog>
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
