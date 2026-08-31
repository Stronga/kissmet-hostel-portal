import { Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { bookingPaymentSummary, createBooking, getBooking, listAvailability, listBookings, listRoomRates, listRooms, updateBookingStatus } from "../../api/bookings";
import { getApplication, getResident, listAcademicSessions, listApplications } from "../../api/applications";
import { listInstitutions } from "../../api/residents";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Application, AvailabilityBed, Booking, BookingPaymentSummary as Summary, BookingStatus, Institution, Resident, Room, RoomRate } from "../../types/api";
import { formatStatus } from "../../utils/format";
import { BookingDetail } from "./BookingDetail";
import { BookingTable } from "./BookingTable";
import { CreateBookingDialog } from "./CreateBookingDialog";

const pageSize = 25;
const statuses: Array<BookingStatus | "all"> = ["all", "pending", "confirmed", "cancelled", "expired", "completed", "archived"];

export function BookingsPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "booking:write");
  const canConfirm = hasPermission(user?.role, "booking:confirm");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [applicationsById, setApplicationsById] = useState<Map<number, Application>>(new Map());
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rates, setRates] = useState<RoomRate[]>([]);
  const [approvedApplications, setApprovedApplications] = useState<Application[]>([]);
  const [availability, setAvailability] = useState<AvailabilityBed[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState<BookingStatus | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ bookings: rows }, institutionRows, sessionRows, roomRows, rateRows, appRows] = await Promise.all([
        listBookings({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listInstitutions(),
        listAcademicSessions(),
        listRooms(),
        listRoomRates(),
        listApplications({ limit: 100, offset: 0 })
      ]);
      const applicationIds = Array.from(new Set(rows.map((booking) => booking.application_id)));
      const listedApps = new Map(appRows.applications.map((application) => [application.id, application]));
      const applicationEntries = await Promise.all(applicationIds.map(async (id) => [id, listedApps.get(id) ?? await getApplication(id)] as const));
      const allApps = [...appRows.applications, ...applicationEntries.map(([, app]) => app)];
      const residentIds = Array.from(new Set([...rows.map((booking) => booking.resident_id), ...allApps.map((application) => application.resident_id)]));
      const residentEntries = await Promise.all(residentIds.map(async (id) => [id, await getResident(id)] as const));
      setBookings(rows);
      setApplicationsById(new Map(applicationEntries));
      setApprovedApplications(appRows.applications.filter((application) => application.status === "approved"));
      setResidentsById(new Map(residentEntries));
      setInstitutions(institutionRows);
      setSessions(sessionRows);
      setRooms(roomRows);
      setRates(rateRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load bookings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visibleBookings = useMemo(() => bookings.filter((booking) => (statusFilter === "all" || booking.status === statusFilter) && (sessionFilter === "all" || booking.academic_session_id === Number(sessionFilter))), [bookings, sessionFilter, statusFilter]);
  const summaryCounts = useMemo(() => ({
    pending: bookings.filter((booking) => booking.status === "pending").length,
    confirmed: bookings.filter((booking) => booking.status === "confirmed").length,
    completed: bookings.filter((booking) => booking.status === "completed").length,
    attention: bookings.filter((booking) => Boolean(booking.payment_attention_required)).length
  }), [bookings]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(booking: Booking) {
    setSelected(booking);
    setSummary(null);
    setSummaryError(null);
    try {
      const [detail, payment] = await Promise.all([getBooking(booking.id), bookingPaymentSummary(booking.id).catch((err) => {
        setSummaryError(err instanceof Error ? err.message : "Unable to load payment summary.");
        return null;
      })]);
      setSelected(detail);
      setSummary(payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load booking.");
    }
  }

  async function loadAvailabilityFor(application: Application | null) {
    setAvailability([]);
    if (!application) return;
    setLoadingAvailability(true);
    try {
      setAvailability(await listAvailability(application.academic_session_id, application.resident_id));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to load availability.");
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function submitCreate(applicationId: number, roomId: number) {
    setSaving(true);
    setCreateError(null);
    try {
      const booking = await createBooking({ applicationId, roomId });
      setCreateOpen(false);
      await load(0, submittedSearch);
      await openDetail(booking);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create booking.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmTransition() {
    if (!selected || !decisionStatus) return;
    setSaving(true);
    setTransitionError(null);
    try {
      const updated = await updateBookingStatus(selected.id, decisionStatus);
      setSelected(updated);
      setBookings((current) => current.map((booking) => booking.id === updated.id ? updated : booking));
      const payment = await bookingPaymentSummary(updated.id).catch(() => null);
      setSummary(payment);
      setDecisionStatus(null);
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : "Unable to update booking.");
    } finally {
      setSaving(false);
    }
  }

  const selectedApplication = selected ? applicationsById.get(selected.application_id) : undefined;
  const selectedResident = selected ? residentsById.get(selected.resident_id) : undefined;
  const selectedInstitution = selectedResident?.institution_id ? institutions.find((item) => item.id === selectedResident.institution_id) : undefined;
  const selectedSession = selected ? sessions.find((item) => item.id === selected.academic_session_id) : undefined;
  const selectedRoom = selected ? rooms.find((item) => item.id === selected.priced_room_id) : undefined;
  const selectedRate = selected ? rates.find((item) => item.id === selected.priced_room_rate_id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Bookings" eyebrow="Admin" description="Manage booking, payment-confirmation and placement readiness." />
        {canWrite ? <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Create Booking</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Pending On Page" value={summaryCounts.pending} /><StatCard label="Confirmed On Page" value={summaryCounts.confirmed} tone="success" /><StatCard label="Completed On Page" value={summaryCounts.completed} /><StatCard label="Payment Attention" value={summaryCounts.attention} tone="warning" /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="booking-search" className="block text-sm font-medium">Search bookings</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="booking-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Booking number or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <div><label htmlFor="booking-status" className="block text-sm font-medium">Status</label><select id="booking-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BookingStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></div>
          <div><label htmlFor="booking-session" className="block text-sm font-medium">Academic session</label><select id="booking-session" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm"><option value="all">All sessions</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></div>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers booking number and status. Status and session filters apply to the current result page.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading bookings..." /> : visibleBookings.length ? <BookingTable bookings={visibleBookings} residentsById={residentsById} applicationsById={applicationsById} institutions={institutions} sessions={sessions} rooms={rooms} onView={(booking) => void openDetail(booking)} /> : <EmptyState title={submittedSearch || statusFilter !== "all" || sessionFilter !== "all" ? "No matching bookings" : "No bookings"} message="Bookings will appear after approved applications are converted into bookings." />}
      <div className="flex items-center justify-between"><button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + bookings.length}</p><button type="button" disabled={bookings.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button></div>
      <ConfirmDialog open={Boolean(selected)} title="Booking Details" onClose={() => { setSelected(null); setDecisionStatus(null); setTransitionError(null); }}>{selected ? <BookingDetail booking={selected} application={selectedApplication} resident={selectedResident} institution={selectedInstitution} session={selectedSession} room={selectedRoom} rate={selectedRate} summary={summary} summaryError={summaryError} canWrite={canWrite} canConfirm={canConfirm} pending={saving} onAction={setDecisionStatus} /> : null}</ConfirmDialog>
      <ConfirmDialog open={Boolean(decisionStatus)} title={decisionStatus === "confirmed" ? "Confirm this booking?" : `${formatStatus(decisionStatus)} booking`} description={decisionStatus === "confirmed" ? "Payment requirements must be satisfied. Confirming the booking does not allocate a bed automatically." : undefined} onClose={() => { if (!saving) setDecisionStatus(null); }}>
        {transitionError ? <p role="alert" className="mb-3 text-sm font-medium text-danger">{transitionError}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setDecisionStatus(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="button" disabled={saving} onClick={() => void confirmTransition()} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button></div>
      </ConfirmDialog>
      <CreateBookingDialog open={createOpen} applications={approvedApplications} residentsById={residentsById} institutions={institutions} sessions={sessions} availability={availability} loadingAvailability={loadingAvailability} error={createError} saving={saving} onApplicationChange={(application) => void loadAvailabilityFor(application)} onCreate={(applicationId, roomId) => void submitCreate(applicationId, roomId)} onClose={() => { if (!saving) { setCreateOpen(false); setCreateError(null); setAvailability([]); } }} />
    </div>
  );
}
