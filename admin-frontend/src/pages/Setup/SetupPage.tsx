import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { listInstitutions } from "../../api/residents";
import { listAcademicSessions } from "../../api/rooms";
import { createAcademicSession, createInstitution, updateAcademicSessionStatus, updateInstitutionStatus } from "../../api/setup";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { DataTable } from "../../components/common/DataTable";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Institution } from "../../types/api";
import { formatStatus } from "../../utils/format";
import { AcademicSessionFormDialog } from "./AcademicSessionFormDialog";
import { InstitutionFormDialog } from "./InstitutionFormDialog";

type TabId = "institutions" | "sessions";

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

export function SetupPage() {
  const { user } = useAuth();
  const canWrite = hasPermission(user?.role, "admin:write");
  const [tab, setTab] = useState<TabId>("institutions");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [institutionFormOpen, setInstitutionFormOpen] = useState(false);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; description?: string; action: () => Promise<void> } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [institutionRows, sessionRows] = await Promise.all([listInstitutions(), listAcademicSessions()]);
      setInstitutions(institutionRows);
      setSessions(sessionRows);
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Setup"
          eyebrow="Administration"
          description="Manage institutions and academic sessions used across residents, applications, bookings and allocations."
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
      </div>

      <div role="tablist" aria-label="Setup sections" className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "institutions"}
          onClick={() => setTab("institutions")}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "institutions" ? "bg-primary text-white" : "border border-border bg-surface text-text-primary"}`}
        >
          Institutions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sessions"}
          onClick={() => setTab("sessions")}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === "sessions" ? "bg-primary text-white" : "border border-border bg-surface text-text-primary"}`}
        >
          Academic Sessions
        </button>
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
