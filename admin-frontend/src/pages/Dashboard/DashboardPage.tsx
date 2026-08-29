import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { FinancePanel } from "../../components/dashboard/FinancePanel";
import { OccupancyPanel } from "../../components/dashboard/OccupancyPanel";
import { PageHeader } from "../../components/layout/PageHeader";
import { useDashboard } from "../../hooks/useDashboard";
import { formatStatus } from "../../utils/format";

export function DashboardPage() {
  const { data, loading, error } = useDashboard();

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (error || !data) return <ErrorState message={error ?? "Dashboard data is unavailable."} />;

  const { overview, occupancy, finance, applications, maintenance } = data;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" eyebrow="Overview" description={`Active session: ${overview.active_academic_session ?? "Not set"}`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Residents" value={overview.total_residents ?? 0} />
        <StatCard label="Active Residents" value={overview.active_residents ?? 0} tone="success" />
        <StatCard label="Applicants" value={overview.applicants ?? 0} />
        <StatCard label="Occupied Beds" value={overview.occupied_beds ?? 0} />
        <StatCard label="Available Beds" value={overview.available_beds ?? 0} tone="success" />
        <StatCard label="Occupancy %" value={`${overview.occupancy_percentage ?? 0}%`} />
        <StatCard label="Pending Applications" value={overview.pending_applications ?? 0} tone="warning" />
        <StatCard label="Confirmed Bookings" value={overview.confirmed_bookings ?? 0} />
        <StatCard label="Open Maintenance" value={overview.open_maintenance_requests ?? 0} />
        <StatCard label="Urgent Maintenance" value={overview.urgent_maintenance_requests ?? 0} tone={(overview.urgent_maintenance_requests ?? 0) > 0 ? "danger" : "default"} />
      </div>

      <OccupancyPanel report={occupancy} />
      <FinancePanel report={finance} />

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-token border border-border bg-surface p-4">
          <h2 className="text-base font-semibold text-text-primary">Applications & Bookings</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {["submitted_applications", "under_review_applications", "approved_applications", "rejected_applications", "pending_bookings", "confirmed_bookings"].map((key) => (
              <div key={key} className="rounded border border-border p-3">
                <p className="text-xs text-text-secondary">{formatStatus(key.replace("_applications", "").replace("_bookings", ""))}</p>
                <p className="mt-1 text-xl font-semibold text-text-primary">{Number(applications[key as keyof typeof applications] ?? 0)}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-token border border-border bg-surface p-4">
          <h2 className="text-base font-semibold text-text-primary">Maintenance</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {["open", "assigned", "in_progress", "resolved", "urgent"].map((key) => (
              <div key={key} className="rounded border border-border p-3">
                <p className="text-xs text-text-secondary">{formatStatus(key)}</p>
                <p className="mt-1 text-xl font-semibold text-text-primary">{Number(maintenance[key as keyof typeof maintenance] ?? 0)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
