import { Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getAuditLog, listAuditLogs } from "../../api/auditLogs";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable } from "../../components/common/DataTable";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AuditLog, Pagination } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

const pageSize = 25;

function blankFilters() {
  return { search: "", actorUserId: "", actorStaffId: "", action: "", entityType: "", dateFrom: "", dateTo: "" };
}

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState(() => blankFilters());
  const [appliedFilters, setAppliedFilters] = useState(() => blankFilters());
  const [pagination, setPagination] = useState<Pagination>({ limit: pageSize, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load(offset = pagination.offset, nextFilters = appliedFilters) {
    setLoading(true);
    setError(null);
    try {
      const result = await listAuditLogs({
        limit: pageSize,
        offset,
        search: nextFilters.search || undefined,
        actorUserId: nextFilters.actorUserId || undefined,
        actorStaffId: nextFilters.actorStaffId || undefined,
        action: nextFilters.action || undefined,
        entityType: nextFilters.entityType || undefined,
        dateFrom: nextFilters.dateFrom || undefined,
        dateTo: nextFilters.dateTo || undefined
      });
      setLogs(result.logs);
      setPagination(result.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load audit logs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0, blankFilters()); }, []);

  const hasFilters = useMemo(() => Object.values(appliedFilters).some(Boolean), [appliedFilters]);

  async function applyFilters(event: FormEvent) {
    event.preventDefault();
    const trimmed = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, value.trim()])) as ReturnType<typeof blankFilters>;
    setAppliedFilters(trimmed);
    await load(0, trimmed);
  }

  async function clearFilters() {
    const next = blankFilters();
    setFilters(next);
    setAppliedFilters(next);
    await load(0, next);
  }

  async function openDetail(id: number) {
    setDetailLoading(true);
    setError(null);
    try {
      setSelected(await getAuditLog(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load audit log.");
    } finally {
      setDetailLoading(false);
    }
  }

  const start = logs.length ? pagination.offset + 1 : 0;
  const end = pagination.offset + logs.length;
  const total = pagination.total;

  return (
    <div className="space-y-5">
      <PageHeader title="Audit Logs" eyebrow="Administration" description="Review administrative and security activity across the hostel portal." />

      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void applyFilters(event)} className="space-y-3">
          <div>
            <label htmlFor="audit-search" className="block text-sm font-medium text-text-primary">Search audit logs</label>
            <div className="mt-1 flex rounded-md border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" aria-hidden />
              <input id="audit-search" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Actor, staff code, action, entity type, or entity ID" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <FilterField label="Actor User ID" value={filters.actorUserId} onChange={(value) => setFilters((current) => ({ ...current, actorUserId: value }))} />
            <FilterField label="Actor Staff ID" value={filters.actorStaffId} onChange={(value) => setFilters((current) => ({ ...current, actorStaffId: value }))} />
            <FilterField label="Action" value={filters.action} onChange={(value) => setFilters((current) => ({ ...current, action: value }))} />
            <FilterField label="Entity Type" value={filters.entityType} onChange={(value) => setFilters((current) => ({ ...current, entityType: value }))} />
            <FilterField label="Date From" type="date" value={filters.dateFrom} onChange={(value) => setFilters((current) => ({ ...current, dateFrom: value }))} />
            <FilterField label="Date To" type="date" value={filters.dateTo} onChange={(value) => setFilters((current) => ({ ...current, dateTo: value }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Apply Filters</button>
            <button type="button" onClick={() => void clearFilters()} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Clear Filters</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Filtering is server-side for search, actor, action, entity type, and date range.</p>
      </section>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading audit logs..." /> : logs.length ? (
        <DataTable<AuditLog>
          rows={logs}
          emptyMessage="No audit activity matches the selected filters."
          columns={[
            { key: "time", header: "Timestamp", render: (log) => formatDateTime(log.created_at) },
            { key: "actor", header: "Actor", render: actorLabel },
            { key: "action", header: "Action", render: (log) => <div><p>{actionLabel(log.action)}</p><p className="text-xs text-text-secondary">{log.action}</p></div> },
            { key: "entity", header: "Entity", render: entityLabel },
            { key: "details", header: "Details", render: metadataSummary },
            { key: "view", header: "View", render: (log) => <button type="button" onClick={() => void openDetail(log.id)} className="text-sm font-semibold text-primary hover:underline">View</button> }
          ]}
        />
      ) : <EmptyState title={hasFilters ? "No matching audit activity" : "No audit activity found"} message={hasFilters ? "No audit activity matches the selected filters." : "No audit activity found."} />}

      <div className="flex items-center justify-between">
        <button type="button" disabled={pagination.offset === 0 || loading} onClick={() => void load(Math.max(0, pagination.offset - pageSize))} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <p className="text-sm text-text-secondary">Showing {start}-{end}{typeof total === "number" ? ` of ${total}` : ""}</p>
        <button type="button" disabled={loading || (typeof total === "number" ? end >= total : logs.length < pageSize)} onClick={() => void load(pagination.offset + pageSize)} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </div>

      <ConfirmDialog open={Boolean(selected) || detailLoading} title="Audit Log Details" onClose={() => setSelected(null)}>
        {detailLoading || !selected ? <LoadingState label="Loading audit log..." /> : <AuditDetail log={selected} />}
      </ConfirmDialog>
    </div>
  );
}

function FilterField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  const id = `audit-${label.toLowerCase().replaceAll(" ", "-")}`;
  return <div><label htmlFor={id} className="block text-sm font-medium text-text-primary">{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></div>;
}

function AuditDetail({ log }: { log: AuditLog }) {
  return (
    <div className="space-y-3">
      <DetailSection title="Event" rows={[["Action", actionLabel(log.action)], ["Exact action key", log.action], ["Timestamp", formatDateTime(log.created_at)]]} />
      <DetailSection title="Actor" rows={[["Name", actorLabel(log)], ["Staff code", log.actor_staff_code], ["Role", log.actor_role_name ?? formatStatus(log.actor_role_code)], ["Actor user ID", log.actor_user_id], ["Actor staff ID", log.actor_staff_id]]} />
      <DetailSection title="Target" rows={[["Entity type", formatStatus(log.entity_type)], ["Entity ID", log.entity_id]]} />
      <DetailSection title="Request Context" rows={[["IP hash", log.ip_hash], ["User agent", log.user_agent]]} />
      <section className="rounded border border-border p-3">
        <h3 className="text-sm font-semibold text-text-primary">Details</h3>
        <MetadataView metadata={log.metadata} />
      </section>
    </div>
  );
}

function DetailSection({ title, rows }: { title: string; rows: [string, string | number | null | undefined][] }) {
  return <section className="rounded border border-border p-3"><h3 className="text-sm font-semibold text-text-primary">{title}</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="font-medium text-text-primary">{value || "Not available"}</dd></div>)}</dl></section>;
}

function actorLabel(log: AuditLog) {
  return log.actor_display_name || (log.actor_user_id ? `User #${log.actor_user_id}` : "Not available");
}

function entityLabel(log: AuditLog) {
  return `${formatStatus(log.entity_type)}${log.entity_id ? ` #${log.entity_id}` : ""}`;
}

function actionLabel(action: string) {
  const withoutPrefix = action.replace(/^admin\./, "").replace(/^resident\./, "");
  return withoutPrefix.split(".").map(formatStatus).join(" ");
}

function metadataSummary(log: AuditLog) {
  const metadata = normalizeMetadata(log.metadata);
  if (!metadata) return "Not available";
  const entries = Object.entries(metadata);
  if (!entries.length) return "Not available";
  const [key, value] = entries[0];
  return `${formatStatus(key)}: ${formatMetadataValue(value)}`;
}

function MetadataView({ metadata }: { metadata: unknown }) {
  const normalized = normalizeMetadata(metadata);
  if (!normalized || !Object.keys(normalized).length) return <p className="mt-2 text-sm text-text-secondary">Not available</p>;
  return <dl className="mt-3 grid gap-2 text-sm">{Object.entries(normalized).map(([key, value]) => <div key={key}><dt className="text-xs text-text-secondary">{formatStatus(key)}</dt><dd className="font-medium text-text-primary">{formatMetadataValue(value)}</dd></div>)}</dl>;
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
    } catch {
      return { value: metadata };
    }
  }
  return typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : { value: metadata };
}

function formatMetadataValue(value: unknown): string {
  if (value == null || value === "") return "Not available";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
