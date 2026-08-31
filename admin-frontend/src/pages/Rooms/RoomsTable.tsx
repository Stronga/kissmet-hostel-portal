import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { OccupancyRoom, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";

export function RoomsTable({ rooms, occupancyByCode, rates, onView }: { rooms: Room[]; occupancyByCode: Map<string, OccupancyRoom>; rates: RoomRate[]; onView: (room: Room) => void }) {
  return (
    <DataTable<Room>
      rows={rooms}
      emptyMessage="No rooms match the current criteria."
      columns={[
        { key: "room", header: "Room", render: (room) => `${room.room_code}${room.room_name ? ` - ${room.room_name}` : ""}` },
        { key: "capacity", header: "Configured Capacity", render: (room) => room.capacity },
        { key: "beds", header: "Actual Beds", render: (room) => occupancyByCode.get(room.room_code)?.active_bed_count ?? room.bed_count ?? "Not available" },
        { key: "occupied", header: "Occupied", render: (room) => occupancyByCode.get(room.room_code)?.occupied_bed_count ?? room.active_occupancy ?? "Not available" },
        { key: "available", header: "Available", render: (room) => {
          const occ = occupancyByCode.get(room.room_code);
          return occ ? Math.max(Number(occ.active_bed_count ?? 0) - Number(occ.occupied_bed_count ?? 0), 0) : room.availability ?? "Not available";
        } },
        { key: "gender", header: "Gender Policy", render: (room) => formatStatus(room.gender_policy) },
        { key: "status", header: "Status", render: (room) => <StatusBadge status={room.status} /> },
        { key: "rate", header: "Active Rate", render: (room) => {
          const rate = rates.find((item) => item.room_id === room.id && item.status === "active");
          return rate ? formatCurrencyMinor(rate.amount_minor, rate.currency) : "No active rate";
        } },
        { key: "actions", header: "Actions", render: (room) => <button type="button" onClick={() => onView(room)} className="text-sm font-semibold text-primary hover:underline">Manage</button> }
      ]}
    />
  );
}
