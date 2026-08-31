import type { ReceiptDetailData } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";
import { methodLabel } from "../Payments/paymentView";

export function PrintableReceipt({ receipt, currency }: { receipt: ReceiptDetailData; currency: string }) {
  return (
    <section className="printable-receipt mx-auto max-w-3xl rounded border border-border bg-white p-6 text-text-primary">
      <style>{`
        @page { size: A4 portrait; margin: 18mm; }
        @media print {
          html, body { width: 210mm; min-height: 297mm; background: #fff !important; }
          body * { visibility: hidden; }
          .printable-receipt, .printable-receipt * { visibility: visible; }
          .printable-receipt {
            position: fixed;
            left: 50%;
            top: 18mm;
            width: 174mm;
            max-width: 174mm;
            min-height: auto;
            transform: translateX(-50%);
            border: 1px solid #d9dee7;
            border-radius: 8px;
            padding: 16mm;
            box-shadow: none;
            color: #172033;
            font-size: 11pt;
            line-height: 1.45;
            page-break-inside: avoid;
          }
          .printable-receipt h3 { font-size: 20pt; line-height: 1.2; }
          .printable-receipt dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm 10mm; }
          .printable-receipt dt { font-size: 8.5pt; color: #5d6678; }
          .printable-receipt dd { font-size: 11pt; color: #172033; }
          .no-print, .no-print * { display: none !important; visibility: hidden !important; }
        }
      `}</style>
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Kissmet Hostel</p>
          <h3 className="mt-1 text-2xl font-semibold text-text-primary">Receipt {receipt.receipt_number}</h3>
        </div>
        {receipt.status === "voided" ? <div className="rounded border-2 border-danger px-3 py-1 text-lg font-bold text-danger">VOID</div> : null}
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <Item label="Resident name" value={receipt.resident_name} />
        <Item label="Resident code" value={receipt.resident_code} />
        <Item label="Student ID" value={receipt.student_id ?? "Not available"} />
        <Item label="Booking number" value={receipt.booking_number ?? "Not available"} />
        <Item label="Payment reference" value={receipt.payment_reference} />
        <Item label="Payment method" value={methodLabel(receipt.method)} />
        <Item label="Amount paid" value={formatCurrencyMinor(receipt.amount_minor, currency)} />
        <Item label="Date paid" value={formatDateTime(receipt.paid_at)} />
        <Item label="Date verified/issued" value={formatDateTime(receipt.issued_at ?? receipt.verified_at)} />
        <Item label="Receipt status" value={formatStatus(receipt.status)} />
      </dl>
      {receipt.status === "voided" ? <p className="mt-4 rounded border border-danger/30 bg-red-50 p-3 text-sm font-medium text-danger">Void reason: {receipt.void_reason || "Not provided"}</p> : null}
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
