import type { ReactNode } from "react";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { Bed, Institution, MaintenanceRequest, Resident, Room, Staff } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";
import { bedLabel, residentName, roomLabel, staffLabel } from "./maintenanceView";
import { MaintenanceActions } from "./MaintenanceActions";

export function MaintenanceDetail({ request, resident, institution, room, bed, assignedStaff, permissions, saving, onAssign, onStart, onResolve, onClose, onCancel }: { request: MaintenanceRequest; resident?: Resident; institution?: Institution; room?: Room; bed?: Bed; assignedStaff?: Staff; permissions: { assign: boolean; update: boolean; resolve: boolean; close: boolean }; saving: boolean; onAssign: () => void; onStart: () => void; onResolve: () => void; onClose: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-3">
      <Section title="Request" rows={[["Request number", request.request_number], ["Status", <StatusBadge status={request.status} />], ["Priority", formatStatus(request.priority)], ["Category", formatStatus(request.category)], ["Issue", request.title], ["Description", request.description || "Not available"], ["Created date", formatDateTime(request.opened_at ?? request.created_at)], ["Resolved date", formatDateTime(request.resolved_at)], ["Closed date", formatDateTime(request.closed_at)]]} />
      <Section title="Resident" rows={[["Resident code", resident?.resident_code ?? "Not linked"], ["Full name", residentName(resident)], ["Student ID", resident?.student_id ?? "Not available"], ["Institution", institution?.name ?? "Not available"]]} />
      <Section title="Placement" rows={[["Academic session", "Not stored on maintenance request"], ["Room", request.room_id ? roomLabel(room) : "Not linked"], ["Bed", request.bed_id ? bedLabel(bed) : "Not linked"], ["Allocation context", "Not stored on maintenance request"]]} />
      <Section title="Assignment" rows={[["Assigned staff", staffLabel(assignedStaff)], ["Assignment date", formatDateTime(request.assigned_at)]]} />
      <Section title="Work Notes / Resolution" rows={[["Notes", request.description || "Not available"], ["Resolution text", "Not stored on maintenance request"], ["Cancellation reason", "Not stored on maintenance request"]]} />
      <section className="rounded border border-border p-3">
        <h3 className="mb-3 text-sm font-semibold">Actions</h3>
        <MaintenanceActions request={request} permissions={permissions} saving={saving} onAssign={onAssign} onStart={onStart} onResolve={onResolve} onClose={onClose} onCancel={onCancel} />
      </section>
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Maintenance requests are work records. Creating or updating a request does not change room status, bed status, bookings, or allocations.</p>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return <section className="rounded border border-border p-3"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl></section>;
}
