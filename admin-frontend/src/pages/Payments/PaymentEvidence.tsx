import type { Payment } from "../../types/api";

export function PaymentEvidence({ payment, canWrite, uploading, onUpload }: { payment: Payment; canWrite: boolean; uploading: boolean; onUpload: (file: File) => void }) {
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold">Payment Evidence</h3>
      <p className="mt-2 text-sm text-text-secondary">Payment slips are private R2 objects. This API supports upload but does not expose public file URLs or payment-scoped slip metadata in the list/detail response.</p>
      {canWrite ? <label className="mt-3 inline-flex cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-semibold">Upload Slip<input aria-label={`Upload slip for ${payment.payment_reference}`} type="file" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); }} /></label> : null}
    </section>
  );
}
