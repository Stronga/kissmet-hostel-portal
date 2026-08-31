import { Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createBed, createRoom, createRoomRate, getRoom, listAcademicSessions, listAllocations, listRoomBeds, listRoomRates, listRooms, occupancyReport, updateBedStatus, updateRoomRateStatus, updateRoomStatus } from "../../api/rooms";
import { getResident } from "../../api/applications";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Allocation, Bed, OccupancyRoom, Resident, Room, RoomRate } from "../../types/api";
import { formatStatus } from "../../utils/format";
import { BedFormDialog } from "./BedFormDialog";
import { RoomDetail } from "./RoomDetail";
import { RoomFormDialog } from "./RoomFormDialog";
import { RoomRateDialog } from "./RoomRateDialog";
import { RoomsTable } from "./RoomsTable";

const statuses = ["all", "available", "maintenance", "inactive", "archived"];
const genders = ["all", "any", "female", "male"];

export function RoomsPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "admin:write");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rates, setRates] = useState<RoomRate[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [occupancy, setOccupancy] = useState<OccupancyRoom[]>([]);
  const [selected, setSelected] = useState<Room | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [bedFormOpen, setBedFormOpen] = useState(false);
  const [rateFormOpen, setRateFormOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; description?: string; action: () => Promise<void> } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [roomRows, rateRows, sessionRows, occupancyRows] = await Promise.all([listRooms(), listRoomRates(), listAcademicSessions(), occupancyReport()]);
      setRooms(roomRows);
      setRates(rateRows);
      setSessions(sessionRows);
      setOccupancy(occupancyRows.rooms ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load rooms.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const occupancyByCode = useMemo(() => new Map(occupancy.map((item) => [item.room_code, item])), [occupancy]);
  const visibleRooms = useMemo(() => rooms.filter((room) => {
    const text = `${room.room_code} ${room.room_name ?? ""}`.toLowerCase();
    return (!submittedSearch || text.includes(submittedSearch.toLowerCase())) && (statusFilter === "all" || room.status === statusFilter) && (genderFilter === "all" || room.gender_policy === genderFilter);
  }), [genderFilter, rooms, statusFilter, submittedSearch]);
  const totals = useMemo(() => ({
    rooms: rooms.length,
    usable: occupancy.reduce((sum, item) => sum + Number(item.active_bed_count ?? 0), 0),
    occupied: occupancy.reduce((sum, item) => sum + Number(item.occupied_bed_count ?? 0), 0)
  }), [occupancy, rooms.length]);

  async function openRoom(room: Room) {
    setSelected(room);
    const [detail, bedRows, allocationRows] = await Promise.all([getRoom(room.id), listRoomBeds(room.id), listAllocations()]);
    const roomAllocations = allocationRows.filter((allocation) => bedRows.some((bed) => bed.id === allocation.bed_id));
    const residentEntries = await Promise.all(Array.from(new Set(roomAllocations.map((allocation) => allocation.resident_id))).map(async (id) => [id, await getResident(id)] as const));
    setSelected(detail);
    setBeds(bedRows);
    setAllocations(roomAllocations);
    setResidentsById(new Map(residentEntries));
  }

  async function refreshSelected() {
    if (selected) await openRoom(selected);
    await load();
  }

  async function withSave(action: () => Promise<void>) {
    setSaving(true); setFormError(null);
    try { await action(); }
    catch (err) { setFormError(err instanceof Error ? err.message : "Request failed."); }
    finally { setSaving(false); }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSubmittedSearch(search.trim());
  }

  const selectedRates = selected ? rates.filter((rate) => rate.room_id === selected.id) : [];
  const selectedOccupancy = selected ? occupancyByCode.get(selected.room_code) : undefined;
  const activeBedCount = beds.filter((bed) => bed.status !== "archived").length;
  const bedCapacityReason = selected && activeBedCount >= selected.capacity ? "The configured capacity has already been reached. The backend also enforces this rule." : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Rooms & Beds" eyebrow="Admin" description="Manage hostel rooms, bed inventory, gender policies and rates." />
        {canWrite ? <button type="button" onClick={() => setRoomFormOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Create Room</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Rooms" value={totals.rooms} /><StatCard label="Usable Beds" value={totals.usable} /><StatCard label="Occupied Beds" value={totals.occupied} /><StatCard label="Available Beds" value={Math.max(totals.usable - totals.occupied, 0)} tone="success" /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={submitSearch} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="room-search" className="block text-sm font-medium">Search rooms</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="room-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Room code or name" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <label className="text-sm font-medium">Status<select aria-label="Room status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></label>
          <label className="text-sm font-medium">Gender<select aria-label="Gender policy filter" value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{genders.map((gender) => <option key={gender} value={gender}>{gender === "all" ? "All policies" : formatStatus(gender)}</option>)}</select></label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Filters apply to the loaded room set. Operational availability uses active bed inventory minus active allocations.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading rooms..." /> : visibleRooms.length ? <RoomsTable rooms={visibleRooms} occupancyByCode={occupancyByCode} rates={rates} onView={(room) => void openRoom(room)} /> : <EmptyState title="No matching rooms" message="No rooms match the current filters." />}
      <ConfirmDialog open={Boolean(selected)} title="Room Management" onClose={() => setSelected(null)}>{selected ? <RoomDetail room={selected} occupancy={selectedOccupancy} beds={beds} allocations={allocations} residentsById={residentsById} rates={selectedRates} sessions={sessions} canWrite={canWrite} onAddBed={() => setBedFormOpen(true)} onBedStatus={(bed, status) => setConfirm({ title: status === "maintenance" ? `Take ${bed.bed_code} out of service?` : `Return ${bed.bed_code} to service?`, description: status === "maintenance" ? "This bed will no longer be available for new allocations." : undefined, action: () => withSave(async () => { await updateBedStatus(bed.id, status); await refreshSelected(); setConfirm(null); }) })} onAddRate={() => setRateFormOpen(true)} onRateStatus={(rate, status) => setConfirm({ title: `Mark ${rate.rate_code} ${formatStatus(status)}?`, action: () => withSave(async () => { await updateRoomRateStatus(rate.id, status); await refreshSelected(); setConfirm(null); }) })} onRoomStatus={(status) => setConfirm({ title: status === "maintenance" ? "Take room out of service?" : "Return room to service?", description: status === "maintenance" ? "This room will no longer be available for new allocations." : undefined, action: () => withSave(async () => { await updateRoomStatus(selected.id, status); await refreshSelected(); setConfirm(null); }) })} /> : null}</ConfirmDialog>
      <RoomFormDialog open={roomFormOpen} saving={saving} error={formError} onClose={() => setRoomFormOpen(false)} onCreate={(input) => void withSave(async () => { await createRoom(input); setRoomFormOpen(false); await load(); })} />
      <BedFormDialog open={bedFormOpen} saving={saving} error={formError} disabledReason={bedCapacityReason} onClose={() => setBedFormOpen(false)} onCreate={(input) => selected ? void withSave(async () => { await createBed({ roomId: selected.id, ...input }); setBedFormOpen(false); await refreshSelected(); }) : undefined} />
      <RoomRateDialog open={rateFormOpen} sessions={sessions} saving={saving} error={formError} onClose={() => setRateFormOpen(false)} onCreate={(input) => selected ? void withSave(async () => { await createRoomRate({ roomId: selected.id, ...input }); setRateFormOpen(false); await refreshSelected(); }) : undefined} />
      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title ?? "Confirm change"} description={confirm?.description} onClose={() => setConfirm(null)}>{formError ? <p role="alert" className="mb-3 text-sm font-medium text-danger">{formError}</p> : null}<div className="flex justify-end gap-2"><button type="button" onClick={() => setConfirm(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void confirm?.action()} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button></div></ConfirmDialog>
    </div>
  );
}
