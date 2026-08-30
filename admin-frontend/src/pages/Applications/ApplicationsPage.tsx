import { Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApplicationDetail } from "./ApplicationDetail";
import { ApplicationTable } from "./ApplicationTable";
import { DecisionDialog } from "./DecisionDialog";
import { getApplication, getResident, listAcademicSessions, listApplications, listIdentityDocuments, updateApplicationStatus } from "../../api/applications";
import { listInstitutions } from "../../api/residents";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Application, ApplicationStatus, IdentityDocument, Institution, Resident } from "../../types/api";
import { formatStatus } from "../../utils/format";

const pageSize = 25;
const statuses: Array<ApplicationStatus | "all"> = ["all", "draft", "submitted", "under_review", "approved", "rejected", "cancelled", "archived"];

export function ApplicationsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.role, "application:write");
  const [applications, setApplications] = useState<Application[]>([]);
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [documents, setDocuments] = useState<IdentityDocument[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<ApplicationStatus | null>(null);

  async function load(nextOffset = offset, nextSearch = submittedSearch) {
    setLoading(true);
    setError(null);
    try {
      const [{ applications: rows }, institutionRows, sessionRows, documentRows] = await Promise.all([
        listApplications({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined }),
        listInstitutions(),
        listAcademicSessions(),
        listIdentityDocuments()
      ]);
      const residentEntries = await Promise.all(
        Array.from(new Set(rows.map((application) => application.resident_id))).map(async (id) => [id, await getResident(id)] as const)
      );
      setApplications(rows);
      setResidentsById(new Map(residentEntries));
      setInstitutions(institutionRows);
      setSessions(sessionRows);
      setDocuments(documentRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(0, "");
  }, []);

  const visibleApplications = useMemo(() => applications.filter((application) => {
    const statusMatch = statusFilter === "all" || application.status === statusFilter;
    const sessionMatch = sessionFilter === "all" || application.academic_session_id === Number(sessionFilter);
    return statusMatch && sessionMatch;
  }), [applications, sessionFilter, statusFilter]);

  const summary = useMemo(() => ({
    totalOnPage: applications.length,
    submittedOnPage: applications.filter((application) => application.status === "submitted").length,
    reviewOnPage: applications.filter((application) => application.status === "under_review").length,
    approvedOnPage: applications.filter((application) => application.status === "approved").length
  }), [applications]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
    await load(0, search.trim());
  }

  async function openDetail(application: Application) {
    setDetailLoading(true);
    setSelected(application);
    try {
      setSelected(await getApplication(application.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load application.");
    } finally {
      setDetailLoading(false);
    }
  }

  function requestAction(status: ApplicationStatus) {
    setTransitionError(null);
    setDecisionStatus(status);
  }

  async function confirmAction(notes?: string) {
    if (!selected || !decisionStatus) return;
    setPendingStatus(true);
    setTransitionError(null);
    try {
      const updated = await updateApplicationStatus(selected.id, decisionStatus, notes);
      setSelected(updated);
      setApplications((current) => current.map((application) => application.id === updated.id ? updated : application));
      setDecisionStatus(null);
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : "Unable to update application.");
    } finally {
      setPendingStatus(false);
    }
  }

  const selectedResident = selected ? residentsById.get(selected.resident_id) : undefined;
  const selectedInstitution = selectedResident?.institution_id ? institutions.find((institution) => institution.id === selectedResident.institution_id) : undefined;
  const selectedSession = selected ? sessions.find((session) => session.id === selected.academic_session_id) : undefined;
  const selectedDocuments = selected ? documents.filter((document) => document.resident_id === selected.resident_id) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Applications" eyebrow="Admin" description="Review and manage hostel applications." />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Applications On Page" value={summary.totalOnPage} />
        <StatCard label="Submitted" value={summary.submittedOnPage} />
        <StatCard label="Under Review" value={summary.reviewOnPage} />
        <StatCard label="Approved" value={summary.approvedOnPage} tone="success" />
      </div>

      <section className="rounded-token border border-border bg-surface p-4">
        <form onSubmit={(event) => void submitSearch(event)} className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <label htmlFor="application-search" className="block text-sm font-medium text-text-primary">Search applications</label>
            <div className="mt-1 flex rounded-md border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="ml-3 mt-2.5 h-4 w-4 text-text-secondary" aria-hidden />
              <input id="application-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Application number or status" className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label htmlFor="application-status" className="block text-sm font-medium text-text-primary">Status</label>
            <select id="application-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ApplicationStatus | "all")} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              {statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="application-session" className="block text-sm font-medium text-text-primary">Academic session</label>
            <select id="application-session" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="all">All sessions</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-text-primary hover:bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Server search covers application number and status. Status and session filters apply to the current result page.</p>
      </section>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading applications..." /> : visibleApplications.length ? (
        <ApplicationTable applications={visibleApplications} residentsById={residentsById} institutions={institutions} sessions={sessions} onView={(application) => void openDetail(application)} />
      ) : (
        <EmptyState title={submittedSearch || statusFilter !== "all" || sessionFilter !== "all" ? "No matching applications" : "No applications"} message={submittedSearch || statusFilter !== "all" || sessionFilter !== "all" ? "No applications match the current search or filters." : "Applications will appear here after residents submit them."} />
      )}

      <div className="flex items-center justify-between">
        <button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - pageSize); setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <p className="text-sm text-text-secondary">Showing {offset + 1}-{offset + applications.length}</p>
        <button type="button" disabled={applications.length < pageSize || loading} onClick={() => { const next = offset + pageSize; setOffset(next); void load(next, submittedSearch); }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </div>

      <ConfirmDialog open={Boolean(selected) || detailLoading} title="Application Details" onClose={() => { setSelected(null); setDecisionStatus(null); setTransitionError(null); }}>
        {detailLoading || !selected ? <LoadingState label="Loading application..." /> : (
          <ApplicationDetail application={selected} resident={selectedResident} institution={selectedInstitution} session={selectedSession} documents={selectedDocuments} canManage={canManage} pending={pendingStatus} onAction={requestAction} />
        )}
      </ConfirmDialog>

      <DecisionDialog open={Boolean(decisionStatus)} status={decisionStatus} pending={pendingStatus} error={transitionError} onCancel={() => { if (!pendingStatus) { setDecisionStatus(null); setTransitionError(null); } }} onConfirm={(notes) => void confirmAction(notes)} />
    </div>
  );
}
