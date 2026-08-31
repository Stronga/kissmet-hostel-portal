import { Plus, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getMaintenance, getMaintenanceReport, listMaintenance, createMaintenance, assignMaintenance, startMaintenance, resolveMaintenance, closeMaintenance, cancelMaintenance, listStaff } from "../../api/maintenance";
import { listInstitutions, listResidents } from "../../api/residents";
import { listRoomBeds, listRooms } from "../../api/rooms";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { Bed, Institution, MaintenancePriority, MaintenanceReport, MaintenanceRequest, MaintenanceStatus, Resident, Room, Staff } from "../../types/api";
import { formatStatus } from "../../utils/format";
import { NoteActionDialog } from "../Payments/NoteActionDialog";
import { AssignMaintenanceDialog } from "./AssignMaintenanceDialog";
import { CreateMaintenanceDialog } from "./CreateMaintenanceDialog";
import { MaintenanceDetail } from "./MaintenanceDetail";
import { MaintenanceTable } from "./MaintenanceTable";

const pageSize = 25;
const statuses: Array<MaintenanceStatus | "all"> = ["all", "open", "assigned", "in_progress", "resolved", "closed", "cancelled", "archived"];
const priorities: Array<MaintenancePriority | "all"> = ["all", "low", "normal", "high", "urgent"];

export function MaintenancePage() {
  const { user } = useAuth();
  const permissions = {
    create: hasPermission(user?.role, "maintenance:create"),
    assign: hasPermission(user?.role, "maintenance:assign"),
    update: hasPermission(user?.role, "maintenance:update"),
    resolve: hasPermission(user?.role, "maintenance:resolve"),
    close: hasPermission(user?.role, "maintenance:close")
  };
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [institutionsById, setInstitutionsById] = useState<Map<number, Institution>>(new Map());
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsById, setRoomsById] = useState<Map<number, Room>>(new Map());
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedsById, setBedsById] = useState<Map<number, Bed>>(new Map());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffById, setStaffById] = useState<Map<number, Staff>>(new Map());
  const [selected, setSelected] = useState<MaintenanceRequest | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<MaintenancePriority | "all">("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [action, setAction] = useState<"start" | "resolve" | "close" | "cancel" | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ requests: requestRows }, reportData, { residents: residentRows }, institutionRows, roomRows, staffRows] = await Promise.all([
        listMaintenance({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        getMaintenanceReport(),
        listResidents({ limit: 100, offset: 0 }),
        listInstitutions(),
        listRooms(),
        listStaff()
      ]);
      const roomBeds = (await Promise.all(roomRows.map((room) => listRoomBeds(room.id)))).flat();
      setRequests(requestRows);
      setReport(reportData);
      setResidents(residentRows);
      setResidentsById(new Map(residentRows.map((resident) => [resident.id, resident])));
      setInstitutionsById(new Map(institutionRows.map((institution) => [institution.id, institution])));
      setRooms(roomRows);
      setRoomsById(new Map(roomRows.map((room) => [room.id, room])));
      setBeds(roomBeds);
      setBedsById(new Map(roomBeds.map((bed) => [bed.id, bed])));
      setStaff(staffRows);
      setStaffById(new Map(staffRows.map((item) => [item.id, item])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load maintenance requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, ""); }, []);

  const visibleRequests = useMemo(() => requests.filter((request) => (statusFilter === "all" || request.status === statusFilter) && (priorityFilter === "all" || request.priority === priorityFilter)), [priorityFilter, requests, statusFilter]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(request: MaintenanceRequest) {
    setMutationError(null);
    try {
      setSelected(await getMaintenance(request.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load maintenance request.");
    }
  }

  async function mutate(run: () => Promise<MaintenanceRequest>, after?: (request: MaintenanceRequest) => void) {
    setSaving(true);
    setMutationError(null);
    try {
      const request = await run();
      setSelected(request);
      after?.(request);
      await load(0, submittedSearch);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  const selectedResident = selected?.resident_id ? residentsById.get(selected.resident_id) : undefined;
  const selectedInstitution = selectedResident?.institution_id ? institutionsById.get(selectedResident.institution_id) : undefined;
  const selectedRoom = selected?.room_id ? roomsById.get(selected.room_id) : undefined;
  const selectedBed = selected?.bed_id ? bedsById.get(selected.bed_id) : undefined;
  const selectedStaff = selected?.assigned_to_staff_id ? staffById.get(selected.assigned_to_staff_id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Maintenance" eyebrow="Admin" description="Track resident-reported issues and maintenance work." />
        {permissions.create ? <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Create Request</button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Open" value={report?.open ?? 0} tone="warning" /><StatCard label="Assigned" value={report?.assigned ?? 0} /><StatCard label="In Progress" value={report?.in_progress ?? 0} tone="warning" /><StatCard label="Resolved" value={report?.resolved ?? 0} tone="success" /></div>
      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1"><label htmlFor="maintenance-search" className="block text-sm font-medium">Search maintenance</label><div className="mt-1 flex rounded-md border border-border bg-white"><Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" /><input id="maintenance-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Request number, issue, or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" /></div></div>
          <label className="text-sm font-medium">Status<select aria-label="Maintenance status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MaintenanceStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}</select></label>
          <label className="text-sm font-medium">Priority<select aria-label="Maintenance priority filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as MaintenancePriority | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2">{priorities.map((priority) => <option key={priority} value={priority}>{priority === "all" ? "All priorities" : formatStatus(priority)}</option>)}</select></label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers request number, title, and status. Resident, room, assigned staff, and priority filters are based on loaded page lookups.</p>
      </section>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading maintenance requests..." /> : visibleRequests.length ? <MaintenanceTable requests={visibleRequests} residentsById={residentsById} roomsById={roomsById} bedsById={bedsById} staffById={staffById} onView={(request) => void openDetail(request)} /> : <EmptyState title={submittedSearch || statusFilter !== "all" || priorityFilter !== "all" ? "No matching maintenance requests" : "No maintenance requests"} message="Maintenance requests will appear after staff or residents report issues." />}
      <div className="flex items-center justify-between"><button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + requests.length}</p><button type="button" disabled={requests.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button></div>
      <ConfirmDialog open={Boolean(selected)} title="Maintenance Details" onClose={() => { setSelected(null); setAssignOpen(false); setAction(null); }}>{selected ? <MaintenanceDetail request={selected} resident={selectedResident} institution={selectedInstitution} room={selectedRoom} bed={selectedBed} assignedStaff={selectedStaff} permissions={permissions} saving={saving} onAssign={() => setAssignOpen(true)} onStart={() => setAction("start")} onResolve={() => setAction("resolve")} onClose={() => setAction("close")} onCancel={() => setAction("cancel")} /> : null}</ConfirmDialog>
      <CreateMaintenanceDialog open={createOpen} residents={residents} rooms={rooms} beds={beds} saving={saving} error={mutationError} onClose={() => { if (!saving) { setCreateOpen(false); setMutationError(null); } }} onCreate={(input) => void mutate(() => createMaintenance(input), (request) => { setCreateOpen(false); void openDetail(request); })} />
      <AssignMaintenanceDialog open={assignOpen} request={selected} staff={staff.filter((item) => item.status === "active")} saving={saving} error={mutationError} onClose={() => { if (!saving) { setAssignOpen(false); setMutationError(null); } }} onAssign={(staffId) => selected ? void mutate(() => assignMaintenance(selected.id, staffId), () => setAssignOpen(false)) : undefined} />
      <NoteActionDialog open={action === "start"} title="Start work?" description="This moves the request from assigned to in progress. It does not change room or bed status." label="Notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={() => selected ? void mutate(() => startMaintenance(selected.id), () => setAction(null)) : undefined} />
      <NoteActionDialog open={action === "resolve"} title="Resolve request?" description="This marks the work as resolved. Closing remains a separate administrative step." label="Resolution notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={() => selected ? void mutate(() => resolveMaintenance(selected.id), () => setAction(null)) : undefined} />
      <NoteActionDialog open={action === "close"} title="Close request?" description="This administratively finalizes a resolved request." label="Close notes" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={() => selected ? void mutate(() => closeMaintenance(selected.id), () => setAction(null)) : undefined} />
      <NoteActionDialog open={action === "cancel"} title="Cancel request?" description="Cancelled requests remain in maintenance history." label="Cancellation reason" saving={saving} error={mutationError} onClose={() => { if (!saving) setAction(null); }} onSubmit={() => selected ? void mutate(() => cancelMaintenance(selected.id), () => setAction(null)) : undefined} />
    </div>
  );
}
