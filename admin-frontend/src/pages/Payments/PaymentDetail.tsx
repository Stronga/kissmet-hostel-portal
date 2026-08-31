import { StatusBadge } from "../../components/common/StatusBadge";
import type { Booking, BookingPaymentSummary, Institution, Payment, Resident, Room } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";
import { PaymentEvidence } from "./PaymentEvidence";
import { PaymentSummary } from "./PaymentSummary";
import { canArchive, canCancel, canRefund, canReject, canSubmit, canVerify, methodLabel, residentName } from "./paymentView";

export function PaymentDetail({ payment, resident, institution, booking, pricedRoom, summary, summaryError, canWrite, canVerifyPayment, saving, uploading, uploadError, onSubmitPayment, onVerify, onReject, onRefund, onCancel, onArchive, onUpload }: { payment: Payment; resident?: Resident; institution?: Institution; booking?: Booking; pricedRoom?: Room; summary: BookingPaymentSummary | null; summaryError: string | null; canWrite: boolean; canVerifyPayment: boolean; saving: boolean; uploading: boolean; uploadError: string | null; onSubmitPayment: () => void; onVerify: () => void; onReject: () => void; onRefund: () => void; onCancel: () => void; onArchive: () => void; onUpload: (file: File) => void }) {
  const attention = Boolean(booking?.payment_attention_required || summary?.paymentAttentionRequired);
  return (
    <div className="space-y-3">
      {attention ? <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><h3 className="font-semibold">Payment attention required</h3><p>{booking?.payment_attention_reason || "This booking has a payment change that requires staff review."}</p></section> : null}
      <Section title="Payment" rows={[["Payment reference", payment.payment_reference], ["Status", <StatusBadge status={payment.status} />], ["Amount", formatCurrencyMinor(payment.amount_minor, payment.currency)], ["Payment method", methodLabel(payment.method)], ["Paid date", formatDateTime(payment.paid_at)], ["Submitted date", formatDateTime(payment.submitted_at ?? payment.created_at)], ["Verified date", formatDateTime(payment.verified_at)], ["Notes", payment.notes || "Not available"]]} />
      <Section title="Resident" rows={[["Resident code", resident?.resident_code ?? "Not available"], ["Full name", residentName(resident)], ["Student ID", resident?.student_id ?? "Not available"], ["Institution", institution?.name ?? "Not available"]]} />
      <Section title="Booking" rows={[["Booking number", booking?.booking_number ?? `Booking #${payment.booking_id ?? "none"}`], ["Booking status", booking ? formatStatus(booking.status) : "Not available"], ["Captured booking total", booking ? formatCurrencyMinor(booking.total_amount_minor, booking.currency) : "Not available"], ["Priced room", pricedRoom ? `${pricedRoom.room_code} ${pricedRoom.room_name ?? ""}` : `Room #${booking?.priced_room_id ?? "unknown"}`]]} />
      <PaymentSummary summary={summary} error={summaryError} />
      <PaymentEvidence payment={payment} canWrite={canWrite} uploading={uploading} onUpload={onUpload} />
      {uploadError ? <p role="alert" className="text-sm font-medium text-danger">{uploadError}</p> : null}
      <section className="rounded border border-border p-3">
        <h3 className="mb-3 text-sm font-semibold">Actions</h3>
        {canWrite || canVerifyPayment ? <div className="flex flex-wrap gap-2">
          {canWrite && canSubmit(payment) ? <button type="button" disabled={saving} onClick={onSubmitPayment} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Submit for Review</button> : null}
          {canVerifyPayment && canVerify(payment) ? <button type="button" disabled={saving} onClick={onVerify} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Verify</button> : null}
          {canVerifyPayment && canReject(payment) ? <button type="button" disabled={saving} onClick={onReject} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Reject</button> : null}
          {canVerifyPayment && canRefund(payment) ? <button type="button" disabled={saving} onClick={onRefund} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Refund</button> : null}
          {canWrite && canCancel(payment) ? <button type="button" disabled={saving} onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button> : null}
          {canWrite && canArchive(payment) ? <button type="button" disabled={saving} onClick={onArchive} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Archive</button> : null}
        </div> : <p className="text-sm text-text-secondary">No payment management permission.</p>}
      </section>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Array<[string, React.ReactNode]> }) {
  return <section className="rounded border border-border p-3"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl></section>;
}
