import { FileText, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getBooking, listBookings } from "../../api/bookings";
import { getPayment, listPayments } from "../../api/payments";
import { getResident } from "../../api/residents";
import { getReceipt, issueReceipt, listReceipts, voidReceipt } from "../../api/receipts";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { Booking, Payment, Receipt, ReceiptDetailData, ReceiptStatus, Resident } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";
import { ReceiptDetail } from "./ReceiptDetail";
import { ReceiptsTable } from "./ReceiptsTable";
import { VoidReceiptDialog } from "./VoidReceiptDialog";

const pageSize = 25;
const statuses: Array<ReceiptStatus | "all"> = ["all", "issued", "voided", "archived"];

export function ReceiptsPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "receipt:write");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsById, setPaymentsById] = useState<Map<number, Payment>>(new Map());
  const [bookingsById, setBookingsById] = useState<Map<number, Booking>>(new Map());
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [selected, setSelected] = useState<ReceiptDetailData | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | undefined>();
  const [selectedBooking, setSelectedBooking] = useState<Booking | undefined>();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReceiptStatus | "all">("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [paymentToIssue, setPaymentToIssue] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ receipts: receiptRows }, { payments: paymentRows }, { bookings: bookingRows }] = await Promise.all([
        listReceipts({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listPayments({ limit: 100, offset: 0 }),
        listBookings({ limit: 100, offset: 0 })
      ]);
      const paymentMap = new Map(paymentRows.map((payment) => [payment.id, payment]));
      const missingPaymentIds = receiptRows.map((receipt: Receipt) => receipt.payment_id).filter((id: number) => !paymentMap.has(id));
      const fetchedPayments = await Promise.all(Array.from(new Set(missingPaymentIds)).map(async (id) => [id, await getPayment(id)] as const));
      fetchedPayments.forEach(([id, payment]) => paymentMap.set(id, payment));
      const bookingMap = new Map(bookingRows.map((booking) => [booking.id, booking]));
      const missingBookingIds = Array.from(paymentMap.values()).map((payment) => payment.booking_id).filter((id): id is number => id !== null && id !== undefined && !bookingMap.has(id));
      const fetchedBookings = await Promise.all(Array.from(new Set(missingBookingIds)).map(async (id) => [id, await getBooking(id)] as const));
      fetchedBookings.forEach(([id, booking]) => bookingMap.set(id, booking));
      const residentIds = Array.from(new Set(Array.from(paymentMap.values()).map((payment) => payment.resident_id)));
      const residentEntries = await Promise.all(residentIds.map(async (id) => [id, await getResident(id)] as const));
      setReceipts(receiptRows);
      setPayments(paymentRows);
      setPaymentsById(paymentMap);
      setBookingsById(bookingMap);
      setResidentsById(new Map(residentEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load receipts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visibleReceipts = useMemo(() => receipts.filter((receipt) => statusFilter === "all" || receipt.status === statusFilter), [receipts, statusFilter]);
  const issuedPaymentIds = useMemo(() => new Set(receipts.filter((receipt) => receipt.status === "issued").map((receipt) => receipt.payment_id)), [receipts]);
  const receiptablePayments = useMemo(() => payments.filter((payment) => payment.status === "verified" && !issuedPaymentIds.has(payment.id)), [issuedPaymentIds, payments]);
  const totals = useMemo(() => ({
    issued: receipts.filter((receipt) => receipt.status === "issued").length,
    voided: receipts.filter((receipt) => receipt.status === "voided").length,
    count: receipts.length,
    value: receipts.reduce((sum, receipt) => sum + Number(paymentsById.get(receipt.payment_id)?.amount_minor ?? 0), 0)
  }), [paymentsById, receipts]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(receipt: Receipt) {
    setMutationError(null);
    try {
      const detail = await getReceipt(receipt.id);
      const payment = paymentsById.get(detail.payment_id) ?? await getPayment(detail.payment_id);
      const booking = payment.booking_id ? bookingsById.get(payment.booking_id) ?? await getBooking(payment.booking_id) : undefined;
      setSelected(detail);
      setSelectedPayment(payment);
      setSelectedBooking(booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load receipt.");
    }
  }

  async function submitIssue() {
    const paymentId = Number(paymentToIssue);
    if (!paymentId) return;
    setSaving(true);
    setMutationError(null);
    try {
      const receipt = await issueReceipt(paymentId);
      setIssueOpen(false);
      setPaymentToIssue("");
      await load(0, submittedSearch);
      setSelected(receipt);
      setSelectedPayment(paymentsById.get(paymentId) ?? await getPayment(paymentId));
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Unable to issue receipt.");
    } finally {
      setSaving(false);
    }
  }

  async function submitVoid(reason?: string) {
    if (!selected) return;
    setSaving(true);
    setMutationError(null);
    try {
      const receipt = await voidReceipt(selected.id, reason);
      setSelected(receipt);
      setVoidOpen(false);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Unable to void receipt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Receipts" eyebrow="Admin" description="Review payment receipts and preserve financial records." />
        {canWrite ? <button type="button" onClick={() => setIssueOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><FileText className="h-4 w-4" /> Issue Receipt</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Active Receipts On Page" value={totals.issued} tone="success" /><StatCard label="Voided Receipts On Page" value={totals.voided} tone="danger" /><StatCard label="Receipts on Page" value={totals.count} /><StatCard label="Total Value on Page" value={formatCurrencyMinor(totals.value, "GHS")} /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="receipt-search" className="block text-sm font-medium">Search receipts</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="receipt-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Receipt number or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <label className="text-sm font-medium">Status<select aria-label="Receipt status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReceiptStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers receipt number and status. Payment, resident, and booking filters are based on loaded page lookups.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading receipts..." /> : visibleReceipts.length ? <ReceiptsTable receipts={visibleReceipts} paymentsById={paymentsById} bookingsById={bookingsById} residentsById={residentsById} onView={(receipt) => void openDetail(receipt)} /> : <EmptyState title={submittedSearch || statusFilter !== "all" ? "No matching receipts" : "No receipts"} message="Receipts will appear after verified payments are issued receipts." />}
      <div className="flex items-center justify-between"><button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + receipts.length}</p><button type="button" disabled={receipts.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button></div>
      <ConfirmDialog open={Boolean(selected)} title="Receipt Details" onClose={() => { setSelected(null); setSelectedPayment(undefined); setSelectedBooking(undefined); setVoidOpen(false); }}>{selected ? <ReceiptDetail receipt={selected} payment={selectedPayment} booking={selectedBooking} canWrite={canWrite} saving={saving} onVoid={() => setVoidOpen(true)} /> : null}</ConfirmDialog>
      <ConfirmDialog open={issueOpen} title="Issue receipt" description="Receipts are created from verified payments. Receipt numbers are generated by the backend." onClose={() => { if (!saving) { setIssueOpen(false); setMutationError(null); } }}>
        <form onSubmit={(event) => { event.preventDefault(); void submitIssue(); }} className="space-y-4">
          <label className="block text-sm font-medium">Verified payment<select aria-label="Verified payment" value={paymentToIssue} onChange={(event) => setPaymentToIssue(event.target.value)} required className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="">Select a verified payment</option>{receiptablePayments.map((payment) => <option key={payment.id} value={payment.id}>{payment.payment_reference} - {formatCurrencyMinor(payment.amount_minor, payment.currency)}</option>)}</select></label>
          {receiptablePayments.length === 0 ? <p className="text-sm text-text-secondary">No loaded verified payments without an issued receipt are available.</p> : null}
          {mutationError ? <p role="alert" className="text-sm font-medium text-danger">{mutationError}</p> : null}
          <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setIssueOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !paymentToIssue} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Issue Receipt</button></div>
        </form>
      </ConfirmDialog>
      <VoidReceiptDialog open={voidOpen} receipt={selected} payment={selectedPayment} saving={saving} error={mutationError} onClose={() => { if (!saving) { setVoidOpen(false); setMutationError(null); } }} onVoid={(reason) => void submitVoid(reason)} />
    </div>
  );
}
