import { DataTable } from "../common/DataTable";
import { StatusBadge } from "../common/StatusBadge";
import type { OccupancyReport, OccupancyRoom } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";

export function OccupancyPanel({ report }: { report: OccupancyReport }) {
  const percent = Number(report.occupancy_percentage ?? 0);
  const rooms = report.rooms ?? [];

  return (
    <section className="space-y-4">
      <div className="rounded-token border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Occupancy</h2>
            <p className="text-sm text-text-secondary">{report.occupied_beds ?? 0} occupied of {report.total_usable_beds ?? 0} usable beds</p>
          </div>
          <p className="text-2xl font-semibold text-text-primary">{percent}%</p>
        </div>
        <div className="mt-4 h-2 rounded-full bg-muted">
          <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
      </div>
      <DataTable<OccupancyRoom>
        rows={rooms}
        emptyMessage="Room-level occupancy will appear once rooms and beds are configured."
        columns={[
          { key: "room", header: "Room", render: (row) => row.room_code },
          { key: "capacity", header: "Capacity", render: (row) => row.configured_capacity },
          { key: "beds", header: "Beds", render: (row) => row.active_bed_count },
          { key: "occupied", header: "Occupied", render: (row) => row.occupied_bed_count },
          { key: "available", header: "Available", render: (row) => Math.max(0, row.active_bed_count - row.occupied_bed_count) },
          { key: "gender", header: "Gender Policy", render: (row) => formatStatus(row.gender_policy) },
          { key: "status", header: "Status", render: (row) => <StatusBadge status={row.room_status} /> },
          { key: "rate", header: "Rate", render: (row) => row.active_rate_minor == null ? "Not set" : formatCurrencyMinor(row.active_rate_minor) }
        ]}
      />
    </section>
  );
}
