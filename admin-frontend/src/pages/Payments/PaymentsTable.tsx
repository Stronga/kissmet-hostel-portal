import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { Booking, Payment, Resident } from "../../types/api";
import { formatCurrencyMinor, formatDateTime } from "../../utils/format";
import { methodLabel, paymentBooking, residentName } from "./paymentView";

export function PaymentsTable({ payments, residentsById, bookingsById, onView }: { payments: Payment[]; residentsById: Map<number, Resident>; bookingsById: Map<number, Booking>; onView: (payment: Payment) => void }) {
  return <DataTable rows={payments} emptyMessage="No payments match the current criteria." columns={[
    { key: "reference", header: "Payment Reference", render: (payment) => payment.payment_reference },
    { key: "resident", header: "Resident", render: (payment) => residentName(residentsById.get(payment.resident_id)) },
    { key: "booking", header: "Booking", render: (payment) => paymentBooking(payment, bookingsById)?.booking_number ?? `Booking #${payment.booking_id ?? "none"}` },
    { key: "amount", header: "Amount", render: (payment) => formatCurrencyMinor(payment.amount_minor, payment.currency) },
    { key: "method", header: "Method", render: (payment) => methodLabel(payment.method) },
    { key: "status", header: "Status", render: (payment) => <StatusBadge status={payment.status} /> },
    { key: "submitted", header: "Submitted", render: (payment) => formatDateTime(payment.submitted_at ?? payment.created_at) },
    { key: "verified", header: "Verified", render: (payment) => formatDateTime(payment.verified_at) },
    { key: "actions", header: "Actions", render: (payment) => <button type="button" onClick={() => onView(payment)} className="text-sm font-semibold text-primary hover:underline">View</button> }
  ]} />;
}
