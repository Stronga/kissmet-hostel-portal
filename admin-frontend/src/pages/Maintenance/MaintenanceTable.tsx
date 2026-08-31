import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { Bed, MaintenanceRequest, Resident, Room, Staff } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";
import { bedLabel, residentName, roomLabel, staffLabel } from "./maintenanceView";

export function MaintenanceTable({ requests, residentsById, roomsById, bedsById, staffById, onView }: { requests: MaintenanceRequest[]; residentsById: Map<number, Resident>; roomsById: Map<number, Room>; bedsById: Map<number, Bed>; staffById: Map<number, Staff>; onView: (request: MaintenanceRequest) => void }) {
  return <DataTable rows={requests} emptyMessage="No maintenance requests match the current criteria." columns={[
    { key: "number", header: "Request Number", render: (request) => request.request_number },
    { key: "resident", header: "Resident", render: (request) => request.resident_id ? residentName(residentsById.get(request.resident_id)) : "Not linked" },
    { key: "placement", header: "Room / Bed", render: (request) => `${request.room_id ? roomLabel(roomsById.get(request.room_id)) : "No room"} / ${request.bed_id ? bedLabel(bedsById.get(request.bed_id)) : "No bed"}` },
    { key: "issue", header: "Issue", render: (request) => <div><p className="font-medium">{request.title}</p><p className="text-xs text-text-secondary">{formatStatus(request.category)}</p></div> },
    { key: "priority", header: "Priority", render: (request) => formatStatus(request.priority) },
    { key: "status", header: "Status", render: (request) => <StatusBadge status={request.status} /> },
    { key: "assigned", header: "Assigned To", render: (request) => request.assigned_to_staff_id ? staffLabel(staffById.get(request.assigned_to_staff_id)) : "Not assigned" },
    { key: "created", header: "Created", render: (request) => formatDateTime(request.opened_at ?? request.created_at) },
    { key: "actions", header: "Actions", render: (request) => <button type="button" onClick={() => onView(request)} className="text-sm font-semibold text-primary hover:underline">View</button> }
  ]} />;
}
