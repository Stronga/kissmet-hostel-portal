import { Copy, Plus, RefreshCw, Search, Wifi } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  disconnectInternetSessions,
  enableInternet,
  ensureInternetProfile,
  getConnectorHealth,
  getInternetAccount,
  getInternetSummary,
  listInternetAccounts,
  listInternetSessions,
  provisionInternet,
  resetInternetPassword,
  retryInternetSync,
  searchEligibleResidents,
  suspendInternet
} from "../../api/internetAccess";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable } from "../../components/common/DataTable";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type {
  ConnectorHealth,
  EligibleResident,
  InternetAccount,
  InternetSession,
  InternetSummary
} from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

const pageSize = 25;
const statusOptions = ["all", "active", "suspended", "disabled"] as const;
const syncOptions = ["all", "pending", "synced", "failed"] as const;

function residentName(account: Pick<InternetAccount, "first_name" | "last_name">) {
  return [account.first_name, account.last_name].filter(Boolean).join(" ") || "Not available";
}

function roomLabel(account: Pick<InternetAccount, "room_code" | "bed_code" | "has_active_allocation">) {
  if (!account.has_active_allocation) return "No active allocation";
  if (account.room_code && account.bed_code) return `${account.room_code} / ${account.bed_code}`;
  return account.room_code || account.bed_code || "Allocated";
}

export function InternetAccessPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.role, "internet:manage");
  const canRead = hasPermission(user?.role, "internet:read");

  const [accounts, setAccounts] = useState<InternetAccount[]>([]);
  const [summary, setSummary] = useState<InternetSummary | null>(null);
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("all");
  const [syncFilter, setSyncFilter] = useState<(typeof syncOptions)[number]>("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<InternetAccount | null>(null);
  const [sessions, setSessions] = useState<InternetSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [action, setAction] = useState<"suspend" | "disconnect" | "reset" | "retry" | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  const [provisionOpen, setProvisionOpen] = useState(false);
  const [eligibleSearch, setEligibleSearch] = useState("");
  const [eligible, setEligible] = useState<EligibleResident[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [eligibleError, setEligibleError] = useState<string | null>(null);
  const [confirmResident, setConfirmResident] = useState<EligibleResident | null>(null);

  const load = useCallback(async (nextOffset = offset, nextSearch = submittedSearch, nextStatus = statusFilter, nextSync = syncFilter) => {
    setLoading(true);
    setError(null);
    try {
      const [{ accounts: rows }, summaryRow] = await Promise.all([
        listInternetAccounts({
          limit: pageSize,
          offset: nextOffset,
          search: nextSearch || undefined,
          status: nextStatus,
          syncStatus: nextSync
        }),
        getInternetSummary().catch(() => null)
      ]);
      setAccounts(rows);
      setSummary(summaryRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load internet accounts.");
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter, submittedSearch, syncFilter]);

  const refreshHealth = useCallback(async () => {
    setHealthError(null);
    try {
      setHealth(await getConnectorHealth());
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : "Unable to check connector health.");
    }
  }, []);

  useEffect(() => {
    if (!canRead) return;
    void load(0, "");
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 120_000);
    return () => window.clearInterval(timer);
  }, [canRead]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim(), statusFilter, syncFilter);
  }

  async function openDetail(account: InternetAccount) {
    setSelected(account);
    setSessions([]);
    setSessionsError(null);
    setMutationError(null);
    setOneTimePassword(null);
    setAction(null);
    setDetailLoading(true);
    try {
      const detail = await getInternetAccount(account.id);
      setSelected(detail);
      try {
        setSessions(await listInternetSessions(account.id));
      } catch (err) {
        setSessionsError(err instanceof Error ? err.message : "Unable to load live sessions.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load internet account.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function mutateAccount(run: () => Promise<InternetAccount & { password?: string }>, closeAction = true) {
    setSaving(true);
    setMutationError(null);
    try {
      const result = await run();
      if (result.password) setOneTimePassword(result.password);
      setSelected(result);
      if (closeAction) setAction(null);
      await load(offset, submittedSearch, statusFilter, syncFilter);
      try {
        setSessions(await listInternetSessions(result.id));
        setSessionsError(null);
      } catch {
        /* sessions optional */
      }
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  async function loadEligible(query: string) {
    setEligibleLoading(true);
    setEligibleError(null);
    try {
      const result = await searchEligibleResidents({ limit: 25, offset: 0, search: query || undefined });
      setEligible(result.residents);
    } catch (err) {
      setEligibleError(err instanceof Error ? err.message : "Unable to search eligible residents.");
    } finally {
      setEligibleLoading(false);
    }
  }

  async function runProvision(resident: EligibleResident) {
    setSaving(true);
    setMutationError(null);
    try {
      const result = await provisionInternet(resident.id);
      if (result.password) setOneTimePassword(result.password);
      setConfirmResident(null);
      setProvisionOpen(false);
      setSelected(result);
      await load(0, submittedSearch, statusFilter, syncFilter);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Unable to provision internet access.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPassword(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* ignore clipboard failures */
    }
  }

  if (!canRead) {
    return <EmptyState title="Internet Access unavailable" message="Your role does not include internet:read permission." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Internet Access"
          eyebrow="Operations"
          description="Staff provisioning for resident HotSpot identities. MikroTik enforces a limit of 3 simultaneous devices per resident."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setProvisionOpen(true);
              setConfirmResident(null);
              setEligibleSearch("");
              setEligible([]);
              setMutationError(null);
              setOneTimePassword(null);
              void loadEligible("");
            }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Provision Resident
          </button>
        ) : null}
      </div>

      <section className="rounded-token border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wifi className={`h-4 w-4 ${health?.ok ? "text-emerald-600" : "text-amber-600"}`} aria-hidden />
            <div>
              <p className="text-sm font-semibold text-text-primary">Connector health</p>
              <p className="text-xs text-text-secondary">
                {healthError
                  ? healthError
                  : health
                    ? health.ok
                      ? `Reachable${health.board ? ` · ${health.board}` : ""}${health.version ? ` · ${health.version}` : ""}`
                      : health.message || "Connector unavailable"
                    : "Checking connector…"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <button
                type="button"
                onClick={() => void ensureInternetProfile().then(() => refreshHealth()).catch((err) => setHealthError(err instanceof Error ? err.message : "Ensure profile failed"))}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
              >
                Ensure Kissmet-Residents profile
              </button>
            ) : null}
            <button type="button" onClick={() => void refreshHealth()} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-text-secondary">Connector issues never block hostel booking, payment, or allocation workflows. Device limit: 3 simultaneous devices.</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Accounts" value={summary?.total ?? "—"} />
        <StatCard label="Active" value={summary?.active ?? "—"} tone="success" />
        <StatCard label="Suspended" value={summary?.suspended ?? "—"} tone="warning" />
        <StatCard label="Sync Failed" value={summary?.sync_failed ?? "—"} tone="danger" />
        <StatCard label="Pending Sync" value={summary?.pending ?? "—"} />
      </div>

      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <label htmlFor="internet-search" className="block text-sm font-medium">Search accounts</label>
            <div className="mt-1 flex rounded-md border border-border bg-white">
              <Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" aria-hidden />
              <input
                id="internet-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Resident code, name, or username"
                className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Internet status filter"
              value={statusFilter}
              onChange={(event) => {
                const next = event.target.value as (typeof statusOptions)[number];
                setStatusFilter(next);
                setOffset(0);
                void load(0, submittedSearch, next, syncFilter);
              }}
              className="mt-1 block rounded-md border border-border bg-white px-3 py-2"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Sync
            <select
              aria-label="Internet sync filter"
              value={syncFilter}
              onChange={(event) => {
                const next = event.target.value as (typeof syncOptions)[number];
                setSyncFilter(next);
                setOffset(0);
                void load(0, submittedSearch, statusFilter, next);
              }}
              className="mt-1 block rounded-md border border-border bg-white px-3 py-2"
            >
              {syncOptions.map((status) => (
                <option key={status} value={status}>{status === "all" ? "All sync states" : formatStatus(status)}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server-side search and filters. Status and sync filters query D1 directly.</p>
      </section>

      {error ? (
        <div className="space-y-2">
          <ErrorState title="Unable to load internet access." message={error} />
          <button type="button" onClick={() => void load(offset, submittedSearch, statusFilter, syncFilter)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Retry</button>
        </div>
      ) : null}

      {loading ? (
        <LoadingState label="Loading internet accounts..." />
      ) : accounts.length ? (
        <DataTable<InternetAccount>
          rows={accounts}
          emptyMessage="No internet accounts match the current criteria."
          columns={[
            { key: "code", header: "Resident", render: (row) => (
              <div>
                <p className="font-medium">{row.resident_code || "—"}</p>
                <p className="text-xs text-text-secondary">{residentName(row)}</p>
              </div>
            ) },
            { key: "room", header: "Room / Bed", render: (row) => roomLabel(row) },
            { key: "username", header: "Username", render: (row) => row.router_username },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "sync", header: "Sync", render: (row) => <StatusBadge status={row.sync_status} /> },
            { key: "synced", header: "Last Synced", render: (row) => formatDateTime(row.last_synced_at) },
            { key: "actions", header: "Actions", render: (row) => (
              <button type="button" onClick={() => void openDetail(row)} className="text-sm font-semibold text-primary hover:underline">View</button>
            ) }
          ]}
        />
      ) : (
        <EmptyState
          title={submittedSearch || statusFilter !== "all" || syncFilter !== "all" ? "No matching accounts" : "No internet accounts"}
          message="Provision a resident with an active allocation to create a HotSpot identity."
        />
      )}

      <div className="flex items-center justify-between">
        <button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch, statusFilter, syncFilter); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <p className="text-sm text-text-secondary">Showing {accounts.length ? offset + 1 : 0}-{offset + accounts.length}</p>
        <button type="button" disabled={accounts.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch, statusFilter, syncFilter); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </div>

      <ConfirmDialog open={Boolean(selected) || detailLoading} title="Internet Account" description="HotSpot identity for one Kissmet resident. Passwords are shown once and never stored in Kissmet." onClose={() => { setSelected(null); setAction(null); setOneTimePassword(null); }}>
        {detailLoading || !selected ? (
          <LoadingState label="Loading account..." />
        ) : (
          <InternetDetail
            account={selected}
            sessions={sessions}
            sessionsError={sessionsError}
            canManage={canManage}
            saving={saving}
            mutationError={mutationError}
            oneTimePassword={oneTimePassword}
            onCopyPassword={(value) => void copyPassword(value)}
            onEnable={() => void mutateAccount(() => enableInternet(selected.id))}
            onSuspend={() => setAction("suspend")}
            onDisconnect={() => setAction("disconnect")}
            onReset={() => setAction("reset")}
            onRetry={() => setAction("retry")}
            onRefreshSessions={() => {
              void listInternetSessions(selected.id).then(setSessions).catch((err) => setSessionsError(err instanceof Error ? err.message : "Unable to load live sessions."));
            }}
          />
        )}
      </ConfirmDialog>

      <ConfirmDialog open={action === "suspend"} title="Suspend internet access?" description="The HotSpot user will be disabled and active sessions disconnected." onClose={() => { if (!saving) setAction(null); }}>
        <ActionFooter saving={saving} error={mutationError} confirmLabel="Suspend" onCancel={() => setAction(null)} onConfirm={() => selected && void mutateAccount(() => suspendInternet(selected.id))} />
      </ConfirmDialog>

      <ConfirmDialog open={action === "disconnect"} title="Disconnect active sessions?" description="Ends current HotSpot sessions for this username. Empty session set is treated as success." onClose={() => { if (!saving) setAction(null); }}>
        <ActionFooter saving={saving} error={mutationError} confirmLabel="Disconnect" onCancel={() => setAction(null)} onConfirm={() => selected && void mutateAccount(async () => {
          const result = await disconnectInternetSessions(selected.id);
          return result.account;
        })} />
      </ConfirmDialog>

      <ConfirmDialog open={action === "reset"} title="Reset HotSpot password?" description="A new password will be generated and shown once. It is not stored in Kissmet." onClose={() => { if (!saving) setAction(null); }}>
        <ActionFooter saving={saving} error={mutationError} confirmLabel="Reset password" onCancel={() => setAction(null)} onConfirm={() => selected && void mutateAccount(() => resetInternetPassword(selected.id))} />
      </ConfirmDialog>

      <ConfirmDialog open={action === "retry"} title="Retry RouterOS sync?" description="Re-pushes the desired D1 state to MikroTik. If the user is missing, a new one-time password may be generated." onClose={() => { if (!saving) setAction(null); }}>
        <ActionFooter saving={saving} error={mutationError} confirmLabel="Retry sync" onCancel={() => setAction(null)} onConfirm={() => selected && void mutateAccount(() => retryInternetSync(selected.id))} />
      </ConfirmDialog>

      <ConfirmDialog
        open={provisionOpen}
        title="Provision Internet Access"
        description="Only residents with an active room/bed allocation can be provisioned. Username is derived from resident code."
        onClose={() => { if (!saving) { setProvisionOpen(false); setConfirmResident(null); } }}
      >
        {confirmResident ? (
          <div className="space-y-4">
            <dl className="grid gap-2 rounded border border-border p-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-text-secondary">Resident</dt><dd className="font-medium">{confirmResident.resident_code} · {[confirmResident.first_name, confirmResident.last_name].filter(Boolean).join(" ")}</dd></div>
              <div><dt className="text-xs text-text-secondary">Room / Bed</dt><dd className="font-medium">{confirmResident.room_code || "—"} / {confirmResident.bed_code || "—"}</dd></div>
              <div><dt className="text-xs text-text-secondary">Username</dt><dd className="font-medium">{confirmResident.resident_code}</dd></div>
              <div><dt className="text-xs text-text-secondary">Device limit</dt><dd className="font-medium">3 simultaneous devices</dd></div>
            </dl>
            {confirmResident.already_provisioned ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">This resident already has an internet account. Provisioning is idempotent.</p> : null}
            {mutationError ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{mutationError}</p> : null}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" disabled={saving} onClick={() => setConfirmResident(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Back</button>
              <button type="button" disabled={saving} onClick={() => void runProvision(confirmResident)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Provisioning..." : "Provision"}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void loadEligible(eligibleSearch.trim());
              }}
              className="flex gap-2"
            >
              <input
                value={eligibleSearch}
                onChange={(event) => setEligibleSearch(event.target.value)}
                placeholder="Search by name, resident code, or student ID"
                className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm"
                aria-label="Search eligible residents"
              />
              <button type="submit" className="rounded-md border border-border bg-muted px-3 py-2 text-sm font-semibold">Search</button>
            </form>
            {eligibleError ? <p role="alert" className="text-sm text-red-700">{eligibleError}</p> : null}
            {eligibleLoading ? <LoadingState label="Searching eligible residents..." /> : eligible.length ? (
              <div className="max-h-72 overflow-y-auto rounded border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Resident</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Room</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Internet</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {eligible.map((resident) => (
                      <tr key={resident.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{resident.resident_code}</p>
                          <p className="text-xs text-text-secondary">{[resident.first_name, resident.last_name].filter(Boolean).join(" ")}</p>
                        </td>
                        <td className="px-3 py-2">{resident.room_code || "—"} / {resident.bed_code || "—"}</td>
                        <td className="px-3 py-2">{resident.already_provisioned ? <StatusBadge status={String(resident.internet_status || "active")} /> : "Not provisioned"}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => setConfirmResident(resident)} className="text-sm font-semibold text-primary hover:underline">Select</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No eligible residents" message="Residents need an active allocation before internet can be provisioned." />
            )}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog open={Boolean(oneTimePassword) && !selected} title="One-time HotSpot password" description="Copy this password now. It will not be shown again and is not stored in Kissmet." onClose={() => setOneTimePassword(null)}>
        {oneTimePassword ? <OneTimePasswordPanel password={oneTimePassword} onCopy={() => void copyPassword(oneTimePassword)} onClose={() => setOneTimePassword(null)} /> : null}
      </ConfirmDialog>
    </div>
  );
}

function InternetDetail({
  account,
  sessions,
  sessionsError,
  canManage,
  saving,
  mutationError,
  oneTimePassword,
  onCopyPassword,
  onEnable,
  onSuspend,
  onDisconnect,
  onReset,
  onRetry,
  onRefreshSessions
}: {
  account: InternetAccount;
  sessions: InternetSession[];
  sessionsError: string | null;
  canManage: boolean;
  saving: boolean;
  mutationError: string | null;
  oneTimePassword: string | null;
  onCopyPassword: (value: string) => void;
  onEnable: () => void;
  onSuspend: () => void;
  onDisconnect: () => void;
  onReset: () => void;
  onRetry: () => void;
  onRefreshSessions: () => void;
}) {
  return (
    <div className="space-y-4">
      {oneTimePassword ? <OneTimePasswordPanel password={oneTimePassword} onCopy={() => onCopyPassword(oneTimePassword)} /> : null}
      <section className="rounded border border-border p-3">
        <h3 className="text-sm font-semibold">Account</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-text-secondary">Resident</dt><dd className="font-medium">{account.resident_code} · {residentName(account)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Room / Bed</dt><dd className="font-medium">{roomLabel(account)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Username</dt><dd className="font-medium">{account.router_username}</dd></div>
          <div><dt className="text-xs text-text-secondary">Profile</dt><dd className="font-medium">{account.router_profile} (3 devices)</dd></div>
          <div><dt className="text-xs text-text-secondary">Status</dt><dd><StatusBadge status={account.status} /></dd></div>
          <div><dt className="text-xs text-text-secondary">Sync</dt><dd><StatusBadge status={account.sync_status} /></dd></div>
          <div><dt className="text-xs text-text-secondary">Last synced</dt><dd className="font-medium">{formatDateTime(account.last_synced_at)}</dd></div>
          <div><dt className="text-xs text-text-secondary">Last sync error</dt><dd className="font-medium">{account.last_sync_error || "None"}</dd></div>
        </dl>
      </section>

      <section className="rounded border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Live sessions</h3>
          <button type="button" onClick={onRefreshSessions} className="text-xs font-semibold text-primary hover:underline">Refresh</button>
        </div>
        {sessionsError ? <p className="mt-2 text-sm text-amber-700">{sessionsError}</p> : null}
        {sessions.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {sessions.map((session) => (
              <li key={session.id} className="rounded bg-muted px-2 py-1">
                {session.address || "No IP"} · {session.macAddress || "No MAC"} · {session.uptime || "uptime n/a"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">No active sessions.</p>
        )}
      </section>

      {mutationError ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{mutationError}</p> : null}

      {canManage ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <button type="button" disabled={saving || (account.status === "active" && account.sync_status === "synced")} onClick={onEnable} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Enable</button>
          <button type="button" disabled={saving} onClick={onSuspend} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Suspend</button>
          <button type="button" disabled={saving} onClick={onDisconnect} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Disconnect sessions</button>
          <button type="button" disabled={saving} onClick={onReset} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Reset password</button>
          <button type="button" disabled={saving} onClick={onRetry} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Retry sync</button>
        </div>
      ) : null}
    </div>
  );
}

function OneTimePasswordPanel({ password, onCopy, onClose }: { password: string; onCopy: () => void; onClose?: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">One-time password — copy now</p>
      <p className="mt-1 text-xs text-amber-800">This password is not stored in Kissmet, localStorage, or audit logs. Share it securely with the resident.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded bg-white px-3 py-2 text-sm font-semibold text-text-primary">{password}</code>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold">
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
        {onClose ? <button type="button" onClick={onClose} className="rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold">Done</button> : null}
      </div>
    </div>
  );
}

function ActionFooter({
  saving,
  error,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  saving: boolean;
  error: string | null;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" disabled={saving} onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
        <button type="button" disabled={saving} onClick={onConfirm} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? "Working..." : confirmLabel}
        </button>
      </div>
    </div>
  );
}
