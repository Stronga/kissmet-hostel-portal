import { Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { bookingPaymentSummary, createPayment, getBooking, getPayment, listPayments, refundPayment, rejectPayment, updatePaymentStatus, uploadPaymentSlip, verifyPayment } from "../../api/payments";
import { listBookings, listRooms } from "../../api/bookings";
import { getResident, listInstitutions } from "../../api/residents";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { Booking, BookingPaymentSummary, Institution, Payment, PaymentStatus, Resident, Room } from "../../types/api";
import { formatStatus } from "../../utils/format";
import { CreatePaymentDialog } from "./CreatePaymentDialog";
import { NoteActionDialog } from "./NoteActionDialog";
import { PaymentDetail } from "./PaymentDetail";
import { PaymentsTable } from "./PaymentsTable";
import { VerifyPaymentDialog } from "./VerifyPaymentDialog";

const pageSize = 25;
const statuses: Array<PaymentStatus | "all"> = ["all", "pending", "submitted", "verified", "rejected", "refunded", "cancelled", "archived"];

export function PaymentsPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "payment:write");
  const canVerifyPayment = hasPermission(user?.role, "payment:verify");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsById, setBookingsById] = useState<Map<number, Booking>>(new Map());
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [summary, setSummary] = useState<BookingPaymentSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<"verify" | "reject" | "refund" | "cancel" | "archive" | "submit" | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ payments: paymentRows }, { bookings: bookingRows }, institutionRows, roomRows] = await Promise.all([
        listPayments({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listBookings({ limit: 100, offset: 0 }),
        listInstitutions(),
        listRooms()
      ]);
      const bookingMap = new Map(bookingRows.map((booking) => [booking.id, booking]));
      const missingBookingIds = Array.from(new Set(paymentRows.map((payment) => payment.booking_id).filter((id): id is number => Boolean(id)))).filter((id) => !bookingMap.has(id));
      const fetchedBookings = await Promise.all(missingBookingIds.map(async (id) => [id, await getBooking(id)] as const));
      fetchedBookings.forEach(([id, booking]) => bookingMap.set(id, booking));
      const residentIds = Array.from(new Set([...paymentRows.map((payment) => payment.resident_id), ...Array.from(bookingMap.values()).map((booking) => booking.resident_id)]));
      const residentEntries = await Promise.all(residentIds.map(async (id) => [id, await getResident(id)] as const));
      setPayments(paymentRows);
      setBookings(bookingRows);
      setBookingsById(bookingMap);
      setResidentsById(new Map(residentEntries));
      setInstitutions(institutionRows);
      setRooms(roomRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load payments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visiblePayments = useMemo(() => payments.filter((payment) => (statusFilter === "all" || payment.status === statusFilter) && (methodFilter === "all" || payment.method === methodFilter)), [methodFilter, payments, statusFilter]);
  const totals = useMemo(() => ({
    submitted: payments.filter((payment) => payment.status === "submitted").length,
    verified: payments.filter((payment) => payment.status === "verified").length,
    rejected: payments.filter((payment) => payment.status === "rejected").length,
    attention: Array.from(bookingsById.values()).filter((booking) => Boolean(booking.payment_attention_required)).length
  }), [bookingsById, payments]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(payment: Payment) {
    setSelected(payment);
    setSummary(null);
    setSummaryError(null);
    setMutationError(null);
    setUploadError(null);
    try {
      const detail = await getPayment(payment.id);
      setSelected(detail);
      if (detail.booking_id) {
        const nextSummary = await bookingPaymentSummary(detail.booking_id).catch((err) => {
          setSummaryError(err instanceof Error ? err.message : "Unable to load payment summary.");
          return null;
        });
        setSummary(nextSummary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load payment.");
    }
  }

  async function mutate(run: () => Promise<Payment>, after?: (payment: Payment) => void) {
    setSaving(true);
    setMutationError(null);
    try {
      const payment = await run();
      setSelected(payment);
      after?.(payment);
      if (payment.booking_id) setSummary(await bookingPaymentSummary(payment.booking_id).catch(() => null));
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  async function submitUpload(file: File) {
    if (!selected) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadPaymentSlip(selected.id, file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Unable to upload payment slip.");
    } finally {
      setUploading(false);
    }
  }

  const selectedBooking = selected?.booking_id ? bookingsById.get(selected.booking_id) : undefined;
  const selectedResident = selected ? residentsById.get(selected.resident_id) : undefined;
  const selectedInstitution = selectedResident?.institution_id ? institutions.find((item) => item.id === selectedResident.institution_id) : undefined;
  const selectedRoom = selectedBooking?.priced_room_id ? rooms.find((room) => room.id === selectedBooking.priced_room_id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Payments" eyebrow="Admin" description="Review resident payments, verify transactions and track booking balances." />
        {canWrite ? <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Add Payment</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Submitted On Page" value={totals.submitted} tone="warning" /><StatCard label="Verified On Page" value={totals.verified} tone="success" /><StatCard label="Rejected On Page" value={totals.rejected} /><StatCard label="Payment Attention" value={totals.attention} tone="warning" /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="payment-search" className="block text-sm font-medium">Search payments</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="payment-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Payment reference or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <label className="text-sm font-medium">Status<select aria-label="Payment status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PaymentStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></label>
          <label className="text-sm font-medium">Method<select aria-label="Payment method filter" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2"><option value="all">All methods</option><option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="other">Other</option></select></label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers payment reference and status. Booking, resident, and method filters are based on loaded page lookups.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading payments..." /> : visiblePayments.length ? <PaymentsTable payments={visiblePayments} residentsById={residentsById} bookingsById={bookingsById} onView={(payment) => void openDetail(payment)} /> : <EmptyState title={submittedSearch || statusFilter !== "all" || methodFilter !== "all" ? "No matching payments" : "No payments"} message="Payments will appear after staff record them against bookings." />}
      <div className="flex items-center justify-between"><button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + payments.length}</p><button type="button" disabled={payments.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button></div>
      <ConfirmDialog open={Boolean(selected)} title="Payment Details" onClose={() => { setSelected(null); setAction(null); }}>{selected ? <PaymentDetail payment={selected} resident={selectedResident} institution={selectedInstitution} booking={selectedBooking} pricedRoom={selectedRoom} summary={summary} summaryError={summaryError} canWrite={canWrite} canVerifyPayment={canVerifyPayment} saving={saving} uploading={uploading} uploadError={uploadError} onSubmitPayment={() => setAction("submit")} onVerify={() => setAction("verify")} onReject={() => setAction("reject")} onRefund={() => setAction("refund")} onCancel={() => setAction("cancel")} onArchive={() => setAction("archive")} onUpload={(file) => void submitUpload(file)} /> : null}</ConfirmDialog>
      <CreatePaymentDialog open={createOpen} bookings={bookings} residentsById={residentsById} saving={saving} error={mutationError} onClose={() => { if (!saving) { setCreateOpen(false); setMutationError(null); } }} onCreate={(input) => void mutate(() => createPayment(input), (payment) => { setCreateOpen(false); void openDetail(payment); })} />
      <VerifyPaymentDialog open={action === "verify"} payment={selected} booking={selectedBooking} resident={selectedResident} summary={summary} saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onVerify={(notes) => selected ? void mutate(async () => (await verifyPayment(selected.id, notes)).payment, (payment) => { setAction(null); void openDetail(payment); }) : undefined} />
      <NoteActionDialog open={action === "reject"} title="Reject payment?" description="Rejected payments remain in history and do not count toward verified totals." label="Rejection notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={(notes) => selected ? void mutate(() => rejectPayment(selected.id, notes), (payment) => { setAction(null); void openDetail(payment); }) : undefined} />
      <NoteActionDialog open={action === "refund"} title="Refund payment?" description="Refunding this payment removes it from the verified payment total. If the related booking is already confirmed, it may require payment review." label="Refund notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={(notes) => selected ? void mutate(async () => (await refundPayment(selected.id, notes)).payment, (payment) => { setAction(null); void openDetail(payment); }) : undefined} />
      <NoteActionDialog open={action === "cancel"} title="Cancel payment?" description="Cancelled payments remain in history and do not count toward verified totals." label="Cancellation notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={(notes) => selected ? void mutate(() => updatePaymentStatus(selected.id, "cancelled", notes), (payment) => { setAction(null); void openDetail(payment); }) : undefined} />
      <NoteActionDialog open={action === "archive"} title="Archive payment?" description="Archiving preserves the payment record while removing it from normal operational workflows." label="Archive notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={(notes) => selected ? void mutate(() => updatePaymentStatus(selected.id, "archived", notes), (payment) => { setAction(null); void openDetail(payment); }) : undefined} />
      <NoteActionDialog open={action === "submit"} title="Submit payment for review?" description="Submitted payments can be verified or rejected by staff with verification permission." label="Submission notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={(notes) => selected ? void mutate(() => updatePaymentStatus(selected.id, "submitted", notes), (payment) => { setAction(null); void openDetail(payment); }) : undefined} />
    </div>
  );
}
