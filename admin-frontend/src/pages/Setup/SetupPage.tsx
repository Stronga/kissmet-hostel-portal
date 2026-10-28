import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listInstitutions } from "../../api/residents";
import { listAcademicSessions } from "../../api/rooms";
import {
  createAcademicSession,
  createInstitution,
  createLeasePeriod,
  createRateCard,
  listLeasePeriods,
  listRateCards,
  updateAcademicSessionStatus,
  updateInstitutionStatus,
  updateLeasePeriod,
  updateLeasePeriodStatus,
  updateRateCard,
  updateRateCardStatus
} from "../../api/setup";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable } from "../../components/common/DataTable";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Institution, LeasePeriod, RateCard } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";
import { AcademicSessionFormDialog } from "./AcademicSessionFormDialog";
import { InstitutionFormDialog } from "./InstitutionFormDialog";
import { LeasePeriodFormDialog } from "./LeasePeriodFormDialog";
import { RateCardFormDialog } from "./RateCardFormDialog";
import { leaseKindLabel, leasePeriodStatusActions, occupancyLabel, rateCardStatusActions } from "./setupLabels";

type TabId = "institutions" | "sessions" | "lease-periods" | "rate-cards";

function institutionActions(status: string): { label: string; status: string }[] {
  if (status === "active") return [{ label: "Set Inactive", status: "inactive" }, { label: "Archive", status: "archived" }];
  if (status === "inactive") return [{ label: "Set Active", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "archived") return [{ label: "Set Active", status: "active" }, { label: "Set Inactive", status: "inactive" }];
  return [{ label: "Set Active", status: "active" }];
}

function sessionActions(status: string): { label: string; status: string }[] {
  if (status === "draft") return [{ label: "Activate", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "active") return [{ label: "Close", status: "closed" }, { label: "Archive", status: "archived" }];
  if (status === "closed") return [{ label: "Activate", status: "active" }, { label: "Archive", status: "archived" }];
  if (status === "archived") return [{ label: "Set Draft", status: "draft" }, { label: "Activate", status: "active" }];
  return [{ label: "Activate", status: "active" }];
}

function sessionLabel(sessions: AcademicSession[], id: number | null) {
  if (id == null) return "—";
  const session = sessions.find((row) => row.id === id);
  return session ? `${session.name} (${session.code})` : `Session #${id}`;
}

export function SetupPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "admin:write");
  const [tab, setTab] = useState<TabId>("institutions");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [leasePeriods, setLeasePeriods] = useState<LeasePeriod[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [institutionFormOpen, setInstitutionFormOpen] = useState(false);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [leaseFormOpen, setLeaseFormOpen] = useState(false);
  const [leaseFormMode, setLeaseFormMode] = useState<"create" | "edit">("create");
  const [editingLease, setEditingLease] = useState<LeasePeriod | null>(null);
  const [rateFormOpen, setRateFormOpen] = useState(false);
  const [rateFormMode, setRateFormMode] = useState<"create" | "edit">("create");
  const [editingRate, setEditingRate] = useState<RateCard | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description?: string; action: () => Promise<void> } | null>(null);

  const leaseById = useMemo(() => new Map(leasePeriods.map((period) => [period.id, period])), [leasePeriods]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [institutionRows, sessionRows, leaseRows, rateRows] = await Promise.all([
        listInstitutions(),
        listAcademicSessions(),
        listLeasePeriods(),
        listRateCards()
      ]);
      setInstitutions(institutionRows);
      setSessions(sessionRows);
      setLeasePeriods(leaseRows);
      setRateCards(rateRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load setup data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function withSave(action: () => Promise<void>) {
    setSaving(true);
    setFormError(null);
    try {
      await action();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSaving(false);
    }
  }

  function requestStatusChange(title: string, description: string | undefined, action: () => Promise<void>) {
    setFormError(null);
    setConfirm({
      title,
      description,
      action: () => withSave(async () => {
        await action();
        setConfirm(null);
        await load();
      })
    });
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "institutions", label: "Institutions" },
    { id: "sessions", label: "Academic Sessions" },
    { id: "lease-periods", label: "Lease Periods" },
    { id: "rate-cards", label: "Rate Cards" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Setup"
          eyebrow="Administration"
          description="Manage institutions, academic sessions, lease periods and default rate cards. Academic Sessions organize school calendars; Lease Periods define Kissmet accommodation contracts; Rate Cards set default prices."
        />
        {canWrite && tab === "institutions" ? (
          <button type="button" onClick={() => { setFormError(null); setInstitutionFormOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Create Institution
          </button>
        ) : null}
        {canWrite && tab === "sessions" ? (
          <button type="button" onClick={() => { setFormError(null); setSessionFormOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Create Academic Session
          </button>
        ) : null}
        {canWrite && tab === "lease-periods" ? (
          <button type="button" onClick={() => { setFormError(null); setLeaseFormMode("create"); setEditingLease(null); setLeaseFormOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Create Lease Period
          </button>
        ) : null}
        {canWrite && tab === "rate-cards" ? (
          <button
            type="button"
            disabled={leasePeriods.length === 0}
            title={leasePeriods.length === 0 ? "Create a lease period before adding rate cards." : undefined}
            onClick={() => { setFormError(null); setRateFormMode("create"); setEditingRate(null); setRateFormOpen(true); }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Create Rate Card
          </button>
        ) : null}
      </div>

      <div role="tablist" aria-label="Setup sections" className="flex flex-wrap gap-2 border-b border-border pb-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === item.id ? "bg-primary text-white" : "border border-border bg-surface text-text-primary"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading setup..." /> : null}

      {!loading && !error && tab === "institutions" ? (
        <section role="tabpanel" aria-label="Institutions">
          <DataTable<Institution>
            rows={institutions}
            emptyMessage="No institutions have been created yet."
            columns={[
              { key: "code", header: "Code", render: (row) => row.code },
              { key: "name", header: "Name", render: (row) => row.name },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
              {
                key: "actions",
                header: "Actions",
                render: (row) => canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    {institutionActions(row.status).map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        onClick={() => requestStatusChange(
                          `${action.label} ${row.code}?`,
                          `Change institution status from ${formatStatus(row.status)} to ${formatStatus(action.status)}.`,
                          async () => { await updateInstitutionStatus(row.id, action.status); }
                        )}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-xs text-text-secondary">View only</span>
              }
            ]}
          />
        </section>
      ) : null}

      {!loading && !error && tab === "sessions" ? (
        <section role="tabpanel" aria-label="Academic Sessions">
          <DataTable<AcademicSession>
            rows={sessions}
            emptyMessage="No academic sessions have been created yet."
            columns={[
              { key: "code", header: "Code", render: (row) => row.code },
              { key: "name", header: "Name", render: (row) => row.name },
              { key: "starts", header: "Starts", render: (row) => row.starts_on ?? "—" },
              { key: "ends", header: "Ends", render: (row) => row.ends_on ?? "—" },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
              {
                key: "actions",
                header: "Actions",
                render: (row) => canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    {sessionActions(row.status).map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        onClick={() => requestStatusChange(
                          `${action.label} ${row.code}?`,
                          action.status === "active"
                            ? "Activating this session will close any other active academic session."
                            : `Change session status from ${formatStatus(row.status)} to ${formatStatus(action.status)}.`,
                          async () => { await updateAcademicSessionStatus(row.id, action.status); }
                        )}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-xs text-text-secondary">View only</span>
              }
            ]}
          />
        </section>
      ) : null}

      {!loading && !error && tab === "lease-periods" ? (
        <section role="tabpanel" aria-label="Lease Periods" className="space-y-3">
          <p className="text-sm text-text-secondary">
            Lease Periods are Kissmet accommodation contract windows (Academic Calendar, Calendar Year, or Short-Term). They are separate from Academic Sessions.
          </p>
          <DataTable<LeasePeriod>
            rows={leasePeriods}
            emptyMessage="No lease periods have been created yet. Create an accommodation period before configuring rate cards."
            columns={[
              { key: "name", header: "Name", render: (row) => row.name },
              { key: "code", header: "Code", render: (row) => row.code },
              { key: "kind", header: "Type", render: (row) => leaseKindLabel(row.kind) },
              { key: "starts", header: "Start", render: (row) => row.starts_on },
              { key: "ends", header: "End", render: (row) => row.ends_on },
              { key: "session", header: "Academic Session", render: (row) => sessionLabel(sessions, row.academic_session_id) },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
              {
                key: "actions",
                header: "Actions",
                render: (row) => canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setFormError(null); setLeaseFormMode("edit"); setEditingLease(row); setLeaseFormOpen(true); }}
                      className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                    >
                      Edit
                    </button>
                    {leasePeriodStatusActions(row.status).map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        onClick={() => requestStatusChange(
                          `${action.label} ${row.code}?`,
                          `Change lease period status from ${formatStatus(row.status)} to ${formatStatus(action.status)}.`,
                          async () => { await updateLeasePeriodStatus(row.id, action.status); }
                        )}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-xs text-text-secondary">View only</span>
              }
            ]}
          />
        </section>
      ) : null}

      {!loading && !error && tab === "rate-cards" ? (
        <section role="tabpanel" aria-label="Rate Cards" className="space-y-3">
          <p className="text-sm text-text-secondary">
            Rate Cards are default accommodation prices per lease period and occupancy. Changes apply to future agreements only and do not change existing resident agreements.
          </p>
          <DataTable<RateCard>
            rows={rateCards}
            emptyMessage={
              leasePeriods.length === 0
                ? "No rate cards yet. Create a lease period first, then configure default prices for 1, 2, or 4 persons."
                : "No rate cards have been configured yet. Add default prices for each occupancy after a lease period exists."
            }
            columns={[
              {
                key: "period",
                header: "Lease Period",
                render: (row) => {
                  const period = leaseById.get(row.lease_period_id);
                  return period ? period.name : `Period #${row.lease_period_id}`;
                }
              },
              {
                key: "kind",
                header: "Lease Type",
                render: (row) => leaseKindLabel(leaseById.get(row.lease_period_id)?.kind)
              },
              { key: "occupancy", header: "Occupancy", render: (row) => occupancyLabel(row.occupancy_capacity) },
              { key: "amount", header: "Amount / resident", render: (row) => formatCurrencyMinor(row.amount_minor, row.currency) },
              { key: "currency", header: "Currency", render: (row) => row.currency },
              {
                key: "package",
                header: "Package months",
                render: (row) => row.package_months == null ? "—" : String(row.package_months)
              },
              {
                key: "effective",
                header: "Effective",
                render: (row) => {
                  if (!row.effective_from && !row.effective_to) return "—";
                  return `${row.effective_from ?? "…"} → ${row.effective_to ?? "…"}`;
                }
              },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
              {
                key: "actions",
                header: "Actions",
                render: (row) => canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    {row.status !== "archived" ? (
                      <button
                        type="button"
                        onClick={() => { setFormError(null); setRateFormMode("edit"); setEditingRate(row); setRateFormOpen(true); }}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                      >
                        Edit
                      </button>
                    ) : null}
                    {rateCardStatusActions(row.status).map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        onClick={() => requestStatusChange(
                          `${action.label} ${row.rate_code}?`,
                          `Change rate card status from ${formatStatus(row.status)} to ${formatStatus(action.status)}. Default rate changes do not rewrite existing resident agreements.`,
                          async () => { await updateRateCardStatus(row.id, action.status); }
                        )}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-xs text-text-secondary">View only</span>
              }
            ]}
          />
        </section>
      ) : null}

      <InstitutionFormDialog
        open={institutionFormOpen}
        saving={saving}
        error={formError}
        onClose={() => setInstitutionFormOpen(false)}
        onCreate={(input) => void withSave(async () => {
          await createInstitution(input);
          setInstitutionFormOpen(false);
          await load();
        })}
      />
      <AcademicSessionFormDialog
        open={sessionFormOpen}
        saving={saving}
        error={formError}
        onClose={() => setSessionFormOpen(false)}
        onCreate={(input) => void withSave(async () => {
          await createAcademicSession(input);
          setSessionFormOpen(false);
          await load();
        })}
      />
      <LeasePeriodFormDialog
        open={leaseFormOpen}
        mode={leaseFormMode}
        initial={editingLease}
        sessions={sessions}
        saving={saving}
        error={formError}
        onClose={() => setLeaseFormOpen(false)}
        onCreate={(input) => void withSave(async () => {
          await createLeasePeriod(input);
          setLeaseFormOpen(false);
          await load();
        })}
        onUpdate={(input) => void withSave(async () => {
          if (!editingLease) return;
          await updateLeasePeriod(editingLease.id, input);
          setLeaseFormOpen(false);
          await load();
        })}
      />
      <RateCardFormDialog
        open={rateFormOpen}
        mode={rateFormMode}
        initial={editingRate}
        leasePeriods={leasePeriods}
        saving={saving}
        error={formError}
        onClose={() => setRateFormOpen(false)}
        onCreate={(input) => void withSave(async () => {
          await createRateCard(input);
          setRateFormOpen(false);
          await load();
        })}
        onUpdate={(input) => void withSave(async () => {
          if (!editingRate) return;
          await updateRateCard(editingRate.id, input);
          setRateFormOpen(false);
          await load();
        })}
      />
      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title ?? "Confirm change"} description={confirm?.description} onClose={() => setConfirm(null)}>
        {formError ? <p role="alert" className="mb-3 text-sm font-medium text-danger">{formError}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(null)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void confirm?.action()} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button>
        </div>
      </ConfirmDialog>
    </div>
  );
}
