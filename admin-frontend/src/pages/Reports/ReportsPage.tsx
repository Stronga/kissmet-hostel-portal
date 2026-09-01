import { Download, Printer, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getReportsApplicationsBookings, getReportsFinance, getReportsMaintenance, getReportsOccupancy, getReportsOverview, getReportsResidents, type ReportFilters } from "../../api/reports";
import { listAcademicSessions } from "../../api/rooms";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, OccupancyReport, ReportsApplicationsBookings, ReportsFinance, ReportsMaintenance, ReportsOverview, ReportsResidents } from "../../types/api";
import { formatCurrencyMinor, formatDateTime, formatStatus } from "../../utils/format";

type Tab = "overview" | "occupancy" | "residents" | "applications" | "finance" | "maintenance";

const residentStatuses = ["all", "prospect", "applicant", "resident", "past_resident", "suspended", "archived"];
const bookingStatuses = ["all", "pending", "confirmed", "cancelled", "expired", "completed", "archived"];

export function ReportsPage() {
  const { user, isLoading } = useAuth();
  const canRead = hasPermission(user?.role, "report:read");
  const canFinance = hasPermission(user?.role, "report:finance");
  const tabs = useMemo<Tab[]>(() => canFinance ? ["overview", "occupancy", "residents", "applications", "finance", "maintenance"] : ["overview", "occupancy", "residents", "applications", "maintenance"], [canFinance]);
  const [active, setActive] = useState<Tab>("overview");
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({ residentStatus: "all", bookingStatus: "all" });
  const [applied, setApplied] = useState<ReportFilters>({ residentStatus: "all", bookingStatus: "all" });
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [occupancy, setOccupancy] = useState<OccupancyReport | null>(null);
  const [residents, setResidents] = useState<ReportsResidents | null>(null);
  const [applications, setApplications] = useState<ReportsApplicationsBookings | null>(null);
  const [finance, setFinance] = useState<ReportsFinance | null>(null);
  const [maintenance, setMaintenance] = useState<ReportsMaintenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(next = applied) {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const [sessionRows, overviewData, occupancyData, residentData, appData, maintenanceData, financeData] = await Promise.all([
        listAcademicSessions(),
        getReportsOverview(next),
        getReportsOccupancy(next),
        getReportsResidents(next),
        getReportsApplicationsBookings(next),
        getReportsMaintenance(next),
        canFinance ? getReportsFinance(next) : Promise.resolve(null)
      ]);
      setSessions(sessionRows);
      setOverview(overviewData);
      setOccupancy(occupancyData);
      setResidents(residentData);
      setApplications(appData);
      setMaintenance(maintenanceData);
      setFinance(financeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [canRead, canFinance]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setApplied(filters);
    void load(filters);
  }

  if (isLoading) return <LoadingState label="Loading reports..." />;
  if (!canRead) return <ErrorState title="Unauthorized report" message="Your role does not have report access." />;

  return <div className="space-y-5 print:space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
      <PageHeader title="Reports" eyebrow="Admin" description="Review hostel occupancy, finance and operational activity." />
      <div className="flex gap-2"><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold"><Printer className="h-4 w-4" /> Print</button><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
    </div>
    <section className="rounded-token border border-border bg-surface p-4 print:hidden">
      <form onSubmit={applyFilters} className="grid gap-3 md:grid-cols-5">
        <label className="text-sm font-medium">Academic Session<select value={filters.academicSessionId ?? ""} onChange={(e) => setFilters({ ...filters, academicSessionId: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2"><option value="">All Sessions</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.status === "active" ? "Active: " : ""}{s.name}</option>)}</select></label>
        <label className="text-sm font-medium">Date From<input type="date" value={filters.dateFrom ?? ""} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <label className="text-sm font-medium">Date To<input type="date" value={filters.dateTo ?? ""} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        <label className="text-sm font-medium">Resident Status<select value={filters.residentStatus ?? "all"} onChange={(e) => setFilters({ ...filters, residentStatus: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2">{residentStatuses.map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}</select></label>
        <label className="text-sm font-medium">Booking Status<select value={filters.bookingStatus ?? "all"} onChange={(e) => setFilters({ ...filters, bookingStatus: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2">{bookingStatuses.map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}</select></label>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white md:col-start-5">Apply Filters</button>
      </form>
      <p className="mt-2 text-xs text-text-secondary">Date boundaries are sent as UTC-stored ISO/date strings and applied only to finance and maintenance reports where timestamp fields exist.</p>
    </section>
    <div className="flex flex-wrap gap-2 print:hidden">{tabs.map((tab) => <button key={tab} type="button" onClick={() => setActive(tab)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${active === tab ? "border-primary bg-primary text-white" : "border-border bg-surface"}`}>{tab === "applications" ? "Applications & Bookings" : formatStatus(tab)}</button>)}</div>
    {error ? <ErrorState message={error} /> : loading ? <LoadingState label="Loading reports..." /> : <section className="space-y-5 print:block">
      <FilterContext sessions={sessions} filters={applied} />
      {active === "overview" && overview ? <OverviewReport data={overview} /> : null}
      {active === "occupancy" && occupancy ? <OccupancyReportView data={occupancy} /> : null}
      {active === "residents" && residents ? <ResidentsReportView data={residents} /> : null}
      {active === "applications" && applications ? <ApplicationsReportView data={applications} /> : null}
      {active === "finance" && canFinance && finance ? <FinanceReportView data={finance} /> : null}
      {active === "maintenance" && maintenance ? <MaintenanceReportView data={maintenance} /> : null}
    </section>}
  </div>;
}

function FilterContext({ sessions, filters }: { sessions: AcademicSession[]; filters: ReportFilters }) {
  const session = filters.academicSessionId ? sessions.find((s) => s.id === filters.academicSessionId)?.name ?? "Selected Session" : "All Sessions";
  return <p className="text-sm text-text-secondary">Scope: {session}. {filters.dateFrom || filters.dateTo ? `Date range: ${filters.dateFrom || "start"} to ${filters.dateTo || "end"}.` : "No date range applied."}</p>;
}

function OverviewReport({ data }: { data: ReportsOverview }) {
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Total Residents" value={data.overview.total_residents ?? 0} /><StatCard label="Applicants" value={data.overview.applicants ?? 0} /><StatCard label="Active Allocations" value={data.occupancy.occupied_beds ?? 0} /><StatCard label="Occupancy" value={`${data.occupancy.occupancy_percentage ?? 0}%`} /></div><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Usable Beds" value={data.occupancy.total_usable_beds ?? 0} /><StatCard label="Available Beds" value={data.occupancy.available_beds ?? 0} /><StatCard label="Pending Bookings" value={data.applicationsBookings.pending_bookings ?? 0} /><StatCard label="Open Maintenance" value={data.maintenance.open ?? 0} tone="warning" /></div></div>;
}

function OccupancyReportView({ data }: { data: OccupancyReport }) {
  const rows = data.rooms ?? [];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Usable Beds" value={data.total_usable_beds ?? 0} /><StatCard label="Occupied Beds" value={data.occupied_beds ?? 0} /><StatCard label="Available Beds" value={data.available_beds ?? 0} /><StatCard label="Occupancy %" value={`${data.occupancy_percentage ?? 0}%`} /></div><ReportTable title="Occupancy by Room" rows={rows} headers={["Room", "Configured Capacity", "Actual Beds", "Occupied Beds", "Available Beds", "Occupancy %", "Gender Policy", "Room Status"]} csvName="occupancy-report.csv" render={(r) => [r.room_code, r.configured_capacity, r.active_bed_count, r.occupied_bed_count, Number(r.active_bed_count ?? 0) - Number(r.occupied_bed_count ?? 0), percent(r.occupied_bed_count, r.active_bed_count), formatStatus(r.gender_policy), formatStatus(r.room_status)]} /></div>;
}

function ResidentsReportView({ data }: { data: ReportsResidents }) {
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-6">{residentStatuses.filter((s) => s !== "all").map((status) => <StatCard key={status} label={formatStatus(status)} value={Number(data.statusCounts.find((c) => c.status === status)?.count ?? 0)} />)}</div><ReportTable title="Resident Placement" rows={data.residents} headers={["Resident Code", "Name", "Student ID", "Institution", "Status", "Current Room / Bed", "Assigned"]} csvName="resident-report.csv" render={(r) => [r.resident_code, `${r.first_name} ${r.last_name}`, r.student_id ?? "Not stored", r.institution_name ?? "Not stored", formatStatus(r.status), r.room_code ? `${r.room_code} / ${r.bed_label ?? "Bed"}` : "No active allocation", formatDateTime(r.assigned_date)]} /></div>;
}

function ApplicationsReportView({ data }: { data: ReportsApplicationsBookings }) {
  const s = data.summary;
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Draft" value={s.draft_applications ?? 0} /><StatCard label="Submitted" value={s.submitted_applications ?? 0} /><StatCard label="Under Review" value={s.under_review_applications ?? 0} /><StatCard label="Approved" value={s.approved_applications ?? 0} /></div><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Rejected" value={s.rejected_applications ?? 0} /><StatCard label="Pending Bookings" value={s.pending_bookings ?? 0} /><StatCard label="Confirmed Bookings" value={s.confirmed_bookings ?? 0} /><StatCard label="Payment Attention" value={data.bookings.filter((b) => Boolean(b.payment_attention_required)).length} tone="warning" /></div><ReportTable title="Booking Financial Basis" rows={data.bookings} headers={["Booking", "Resident", "Academic Session", "Priced Room", "Captured Amount", "Verified", "Outstanding", "Status", "Payment Attention"]} csvName="booking-report.csv" render={(b) => [b.booking_number, `${b.first_name} ${b.last_name}`, b.academic_session_name ?? "Not stored", b.priced_room_code ?? "Not stored", formatCurrencyMinor(b.total_amount_minor, b.currency), formatCurrencyMinor(b.verified_amount_minor, b.currency), formatCurrencyMinor(b.outstanding_amount_minor, b.currency), formatStatus(b.status), Boolean(b.payment_attention_required) ? "Yes" : "No"]} /></div>;
}

function FinanceReportView({ data }: { data: ReportsFinance }) {
  const s = data.summary;
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Expected Revenue" value={formatCurrencyMinor(s.expected_booking_revenue)} /><StatCard label="Verified Revenue" value={formatCurrencyMinor(s.verified_payments)} tone="success" /><StatCard label="Outstanding" value={formatCurrencyMinor(s.outstanding_booking_balances)} tone="warning" /><StatCard label="Refunded" value={formatCurrencyMinor(s.refunded_totals)} /></div><div className="grid gap-3 sm:grid-cols-3"><StatCard label="Pending/Submitted" value={formatCurrencyMinor(s.pending_submitted_payment_totals)} /><StatCard label="Confirmation-Eligible Bookings" value={s.fully_paid_bookings ?? 0} /><StatCard label="Payment Attention" value={s.bookings_requiring_payment_attention ?? 0} tone="danger" /></div><ReportTable title="Verified Revenue by Payment Method" rows={data.paymentMethods} headers={["Method", "Count", "Verified Amount"]} csvName="payment-method-report.csv" render={(m) => [formatStatus(m.method), m.count, formatCurrencyMinor(m.verified_amount_minor)]} /><ReportTable title="Outstanding Balances" rows={data.outstanding.balances} headers={["Resident", "Booking", "Booking Total", "Verified", "Outstanding", "Booking Status", "Payment Attention"]} csvName="outstanding-report.csv" render={(b) => [`${b.first_name} ${b.last_name}`, b.booking_number, formatCurrencyMinor(b.total_amount_minor, b.currency), formatCurrencyMinor(b.verified_amount_minor, b.currency), formatCurrencyMinor(b.outstanding_amount_minor, b.currency), formatStatus(b.status), Boolean(b.payment_attention_required) ? "Yes" : "No"]} /></div>;
}

function MaintenanceReportView({ data }: { data: ReportsMaintenance }) {
  const s = data.summary;
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-6"><StatCard label="Open" value={s.open ?? 0} /><StatCard label="Assigned" value={s.assigned ?? 0} /><StatCard label="In Progress" value={s.in_progress ?? 0} /><StatCard label="Resolved" value={s.resolved ?? 0} /><StatCard label="Closed" value={s.closed ?? 0} /><StatCard label="Cancelled" value={s.cancelled ?? 0} /></div><ReportTable title="Maintenance by Category" rows={data.byCategory} headers={["Category", "Count"]} csvName="maintenance-category-report.csv" render={(r) => [formatStatus(r.category), r.count]} /><ReportTable title="Maintenance by Priority" rows={data.byPriority} headers={["Priority", "Count"]} csvName="maintenance-priority-report.csv" render={(r) => [formatStatus(r.priority), r.count]} /></div>;
}

function ReportTable<T>({ title, rows, headers, render, csvName }: { title: string; rows: T[]; headers: string[]; render: (row: T) => Array<string | number>; csvName: string }) {
  if (!rows.length) return <EmptyState title={`No data for ${title}`} message="Adjust the report filters or add operational records." />;
  return <section className="rounded-token border border-border bg-surface p-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-base font-semibold">{title}</h3><button type="button" onClick={() => exportCsv(csvName, headers, rows.map(render))} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold print:hidden"><Download className="h-4 w-4" /> CSV</button></div><div className="overflow-x-auto"><table className="min-w-full divide-y divide-border text-sm"><thead className="bg-muted"><tr>{headers.map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((row, idx) => <tr key={idx}>{render(row).map((cell, cellIdx) => <td key={cellIdx} className="px-3 py-2">{String(cell).toLowerCase().includes("archived") || String(cell).toLowerCase().includes("confirmed") ? <StatusBadge status={String(cell)} /> : cell}</td>)}</tr>)}</tbody></table></div></section>;
}

function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const quote = (value: string | number) => `"${String(value).replaceAll("\"", "\"\"")}"`;
  const csv = [headers.map(quote).join(","), ...rows.map((row) => row.map(quote).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function percent(value?: number, total?: number) {
  const t = Number(total ?? 0);
  if (!t) return "0%";
  return `${Math.round((Number(value ?? 0) * 10000) / t) / 100}%`;
}
