import { Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createAllocation, getAllocation, getBooking, listAllocations, listAvailability, listRoomBeds, transferAllocation, updateAllocationStatus } from "../../api/allocations";
import { listAcademicSessions } from "../../api/applications";
import { listBookings, listRoomRates, listRooms } from "../../api/bookings";
import { getResident, listInstitutions } from "../../api/residents";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Allocation, AvailabilityBed, Bed, Booking, Institution, Resident, Room, RoomRate } from "../../types/api";
import { formatStatus } from "../../utils/format";
import { AllocationDetail } from "./AllocationDetail";
import { AllocationsTable } from "./AllocationsTable";
import { bookingEligible } from "./allocationView";
import { CreateAllocationDialog } from "./CreateAllocationDialog";
import { TransferAllocationDialog } from "./TransferAllocationDialog";

const pageSize = 25;
const statuses = ["all", "active", "ended", "cancelled", "transferred", "archived"];

export function AllocationsPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "allocation:write");
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsById, setBookingsById] = useState<Map<number, Booking>>(new Map());
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rates, setRates] = useState<RoomRate[]>([]);
  const [bedsByRoom, setBedsByRoom] = useState<Map<number, Bed[]>>(new Map());
  const [availability, setAvailability] = useState<AvailabilityBed[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Allocation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<"ended" | "cancelled" | "archived" | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ allocations: allocationRows }, { bookings: bookingRows }, sessionRows, institutionRows, roomRows, rateRows] = await Promise.all([
        listAllocations({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listBookings({ limit: 100, offset: 0 }),
        listAcademicSessions(),
        listInstitutions(),
        listRooms(),
        listRoomRates()
      ]);
      const relatedBookingIds = Array.from(new Set(allocationRows.map((allocation) => allocation.booking_id)));
      const bookingMap = new Map(bookingRows.map((booking) => [booking.id, booking]));
      const fetchedBookings = await Promise.all(relatedBookingIds.filter((id) => !bookingMap.has(id)).map(async (id) => [id, await getBooking(id)] as const));
      fetchedBookings.forEach(([id, booking]) => bookingMap.set(id, booking));
      const residentIds = Array.from(new Set([...allocationRows.map((allocation) => allocation.resident_id), ...bookingRows.map((booking) => booking.resident_id)]));
      const residentEntries = await Promise.all(residentIds.map(async (id) => [id, await getResident(id)] as const));
      const bedEntries = await Promise.all(roomRows.map(async (room) => [room.id, await listRoomBeds(room.id)] as const));
      setAllocations(allocationRows);
      setBookings(bookingRows);
      setBookingsById(bookingMap);
      setResidentsById(new Map(residentEntries));
      setInstitutions(institutionRows);
      setSessions(sessionRows);
      setRooms(roomRows);
      setRates(rateRows);
      setBedsByRoom(new Map(bedEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load allocations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visibleAllocations = useMemo(() => allocations.filter((allocation) => (statusFilter === "all" || allocation.status === statusFilter) && (sessionFilter === "all" || allocation.academic_session_id === Number(sessionFilter))), [allocations, sessionFilter, statusFilter]);
  const totals = useMemo(() => ({
    active: allocations.filter((allocation) => allocation.status === "active").length,
    availableBeds: rooms.reduce((sum, room) => sum + (bedsByRoom.get(room.id)?.filter((bed) => bed.status === "available" && !allocations.some((allocation) => allocation.bed_id === bed.id && allocation.status === "active")).length ?? 0), 0),
    ready: bookings.filter((booking) => bookingEligible(booking, allocations)).length,
    transfers: allocations.filter((allocation) => allocation.status === "transferred").length
  }), [allocations, bedsByRoom, bookings, rooms]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(allocation: Allocation) {
    setSelected(allocation);
    setMutationError(null);
    try {
      const detail = await getAllocation(allocation.id);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load allocation.");
    }
  }

  async function loadAvailabilityFor(booking: Booking | null) {
    setAvailability([]);
    if (!booking) return;
    setLoadingAvailability(true);
    setMutationError(null);
    try {
      setAvailability(await listAvailability(booking.academic_session_id, booking.resident_id));
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Unable to load availability.");
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function mutate(action: () => Promise<Allocation>, after?: (allocation: Allocation) => void) {
    setSaving(true);
    setMutationError(null);
    try {
      const allocation = await action();
      after?.(allocation);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  const selectedBooking = selected ? bookingsById.get(selected.booking_id) : undefined;
  const selectedResident = selected ? residentsById.get(selected.resident_id) : undefined;
  const selectedInstitution = selectedResident?.institution_id ? institutions.find((item) => item.id === selectedResident.institution_id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Allocations" eyebrow="Admin" description="Assign residents to beds and manage placement history." />
        {canWrite ? <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Allocate Bed</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Active On Page" value={totals.active} tone="success" /><StatCard label="Available Beds" value={totals.availableBeds} /><StatCard label="Ready On Loaded Bookings" value={totals.ready} /><StatCard label="Transfers On Page" value={totals.transfers} /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="allocation-search" className="block text-sm font-medium">Search allocations</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="allocation-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Backend search supports allocation status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <label className="text-sm font-medium">Status<select aria-label="Allocation status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></label>
          <label className="text-sm font-medium">Academic session<select aria-label="Allocation session filter" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2"><option value="all">All sessions</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers allocation status. Resident, booking, room, and session filters are based on loaded page lookups.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading allocations..." /> : visibleAllocations.length ? <AllocationsTable allocations={visibleAllocations} residentsById={residentsById} bookingsById={bookingsById} sessions={sessions} rooms={rooms} bedsByRoom={bedsByRoom} onView={(allocation) => void openDetail(allocation)} /> : <EmptyState title={submittedSearch || statusFilter !== "all" || sessionFilter !== "all" ? "No matching allocations" : "No allocations"} message="Allocations will appear after confirmed bookings are explicitly assigned to beds." />}
      <div className="flex items-center justify-between"><button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + allocations.length}</p><button type="button" disabled={allocations.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button></div>
      <ConfirmDialog open={Boolean(selected)} title="Allocation Details" onClose={() => { setSelected(null); setDecisionStatus(null); setMutationError(null); }}>{selected ? <AllocationDetail allocation={selected} allocations={allocations} resident={selectedResident} institution={selectedInstitution} booking={selectedBooking} sessions={sessions} rooms={rooms} bedsByRoom={bedsByRoom} rates={rates} canWrite={canWrite} pending={saving} onTransfer={() => { setTransferOpen(true); void loadAvailabilityFor(selectedBooking ?? null); }} onStatus={setDecisionStatus} /> : null}</ConfirmDialog>
      <ConfirmDialog open={Boolean(decisionStatus)} title={`${formatStatus(decisionStatus)} allocation?`} description="This preserves allocation history and does not change booking or payment records." onClose={() => { if (!saving) setDecisionStatus(null); }}>
        {mutationError ? <p role="alert" className="mb-3 text-sm font-medium text-danger">{mutationError}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setDecisionStatus(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="button" disabled={saving || !selected || !decisionStatus} onClick={() => selected && decisionStatus ? void mutate(() => updateAllocationStatus(selected.id, decisionStatus), (allocation) => { setSelected(allocation); setDecisionStatus(null); }) : undefined} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button></div>
      </ConfirmDialog>
      <CreateAllocationDialog open={createOpen} bookings={bookings} allocations={allocations} residentsById={residentsById} sessions={sessions} rooms={rooms} rates={rates} availability={availability} loadingAvailability={loadingAvailability} error={mutationError} saving={saving} onBookingChange={(booking) => void loadAvailabilityFor(booking)} onClose={() => { if (!saving) { setCreateOpen(false); setMutationError(null); setAvailability([]); } }} onCreate={(input) => void mutate(() => createAllocation(input), (allocation) => { setCreateOpen(false); setAvailability([]); void openDetail(allocation); })} />
      <TransferAllocationDialog open={transferOpen} allocation={selected} booking={selectedBooking} rooms={rooms} bedsByRoom={bedsByRoom} sessions={sessions} availability={availability} loadingAvailability={loadingAvailability} error={mutationError} saving={saving} onClose={() => { if (!saving) { setTransferOpen(false); setMutationError(null); setAvailability([]); } }} onTransfer={(input) => selected ? void mutate(() => transferAllocation(selected.id, input), (allocation) => { setTransferOpen(false); setAvailability([]); void openDetail(allocation); }) : undefined} />
    </div>
  );
}
