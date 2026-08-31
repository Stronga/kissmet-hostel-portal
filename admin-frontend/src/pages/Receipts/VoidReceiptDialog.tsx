import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { Payment, ReceiptDetailData } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

export function VoidReceiptDialog({ open, receipt, payment, saving, error, onClose, onVoid }: { open: boolean; receipt: ReceiptDetailData | null; payment?: Payment; saving: boolean; error: string | null; onClose: () => void; onVoid: (reason?: string) => void }) {
  const [reason, setReason] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    onVoid(reason.trim() || undefined);
  }
  return (
    <ConfirmDialog open={open} title="Void this receipt?" description="The receipt will remain in the financial record and cannot be deleted." onClose={onClose}>
      {receipt ? <form onSubmit={submit} className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Item label="Receipt Number" value={receipt.receipt_number} />
          <Item label="Payment Reference" value={receipt.payment_reference} />
          <Item label="Resident" value={receipt.resident_name} />
          <Item label="Amount" value={formatCurrencyMinor(receipt.amount_minor, payment?.currency ?? "GHS")} />
        </dl>
        <label className="block text-sm font-medium">Void reason<textarea aria-label="Void reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving} className="rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Void Receipt</button></div>
      </form> : null}
    </ConfirmDialog>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
