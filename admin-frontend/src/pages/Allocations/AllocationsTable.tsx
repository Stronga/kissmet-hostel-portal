import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { AcademicSession, Allocation, Bed, Booking, Resident, Room } from "../../types/api";
import { formatDateTime } from "../../utils/format";
import { placementLabel, residentName, sessionName } from "./allocationView";

export function AllocationsTable({ allocations, residentsById, bookingsById, sessions, rooms, bedsByRoom, onView }: { allocations: Allocation[]; residentsById: Map<number, Resident>; bookingsById: Map<number, Booking>; sessions: AcademicSession[]; rooms: Room[]; bedsByRoom: Map<number, Bed[]>; onView: (allocation: Allocation) => void }) {
  return <DataTable rows={allocations} emptyMessage="No allocations match the current criteria." columns={[
    { key: "resident", header: "Resident", render: (allocation) => residentName(residentsById.get(allocation.resident_id)) },
    { key: "booking", header: "Booking", render: (allocation) => bookingsById.get(allocation.booking_id)?.booking_number ?? `Booking #${allocation.booking_id}` },
    { key: "session", header: "Academic Session", render: (allocation) => sessionName(allocation.academic_session_id, sessions) },
    { key: "placement", header: "Room / Bed", render: (allocation) => placementLabel(allocation.bed_id, rooms, bedsByRoom).label },
    { key: "status", header: "Status", render: (allocation) => <StatusBadge status={allocation.status} /> },
    { key: "assigned", header: "Assigned", render: (allocation) => formatDateTime(allocation.starts_on ?? allocation.created_at) },
    { key: "ended", header: "Ended", render: (allocation) => formatDateTime(allocation.ends_on ?? allocation.released_at) },
    { key: "actions", header: "Actions", render: (allocation) => <button type="button" onClick={() => onView(allocation)} className="text-sm font-semibold text-primary hover:underline">View</button> }
  ]} />;
}
