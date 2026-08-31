import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { Booking, Payment, Receipt, Resident } from "../../types/api";
import { formatCurrencyMinor, formatDateTime } from "../../utils/format";
import { receiptAmount, receiptBooking, receiptPayment, receiptResident, residentName } from "./receiptView";

export function ReceiptsTable({ receipts, paymentsById, bookingsById, residentsById, onView }: { receipts: Receipt[]; paymentsById: Map<number, Payment>; bookingsById: Map<number, Booking>; residentsById: Map<number, Resident>; onView: (receipt: Receipt) => void }) {
  return <DataTable rows={receipts} emptyMessage="No receipts match the current criteria." columns={[
    { key: "number", header: "Receipt Number", render: (receipt) => receipt.receipt_number },
    { key: "payment", header: "Payment Reference", render: (receipt) => receiptPayment(receipt, paymentsById)?.payment_reference ?? `Payment #${receipt.payment_id}` },
    { key: "resident", header: "Resident", render: (receipt) => residentName(receiptResident(receipt, paymentsById, residentsById)) },
    { key: "booking", header: "Booking", render: (receipt) => receiptBooking(receipt, paymentsById, bookingsById)?.booking_number ?? "Not available" },
    { key: "amount", header: "Amount", render: (receipt) => formatCurrencyMinor(receiptAmount(receipt, receiptPayment(receipt, paymentsById)), receiptPayment(receipt, paymentsById)?.currency ?? "GHS") },
    { key: "status", header: "Status", render: (receipt) => <StatusBadge status={receipt.status} /> },
    { key: "issued", header: "Issued", render: (receipt) => formatDateTime(receipt.issued_at) },
    { key: "actions", header: "Actions", render: (receipt) => <button type="button" onClick={() => onView(receipt)} className="text-sm font-semibold text-primary hover:underline">View</button> }
  ]} />;
}
