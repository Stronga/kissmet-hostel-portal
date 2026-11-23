import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { Payment } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

/**
 * Refund request (milestone 2): a request only. A different authorized staff member approves it on
 * the Refunds page, and the payout (method + reference) is recorded there; that is when net verified
 * payments drop, a credit note is issued, and (on a full refund) the receipt is voided.
 */
export function RefundRequestDialog({ open, payment, saving, error, onSubmit, onClose }: { open: boolean; payment: Payment | null; saving: boolean; error: string | null; onSubmit: (input: { amountMinor?: number; reason: string }) => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const remaining = payment ? payment.amount_minor - Number(payment.refunded_amount_minor ?? 0) : 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!reason.trim()) return;
    let amountMinor: number | undefined;
    if (amount.trim()) {
      const parsed = Math.round(Number(amount) * 100);
      if (!Number.isFinite(parsed) || parsed <= 0) { setLocalError("Enter a positive amount, or leave it empty for a full refund."); return; }
      amountMinor = parsed;
    }
    onSubmit({ amountMinor, reason: reason.trim() });
  }
  return (
    <ConfirmDialog open={open} title="Request refund" description={`A different staff member must approve this request before the payout is recorded. Refundable now: up to ${formatCurrencyMinor(remaining, payment?.currency)} (less any open requests).`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">Refund amount (leave empty for the full remaining amount)<input aria-label="Refund amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" placeholder="e.g. 250.00" /></label>
        <label className="block text-sm font-medium">Refund reason<textarea aria-label="Refund reason" required value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError ?? error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !reason.trim()} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit request</button></div>
      </form>
    </ConfirmDialog>
  );
}
