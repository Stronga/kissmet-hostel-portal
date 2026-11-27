import { Search } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApplicationDetail } from "./ApplicationDetail";
import { ApplicationTable } from "./ApplicationTable";
import { CreateAgreementDialog } from "./CreateAgreementDialog";
import { DecisionDialog } from "./DecisionDialog";
import { getApplication, getResident, listAcademicSessions, listApplications, listIdentityDocuments, updateApplicationStatus } from "../../api/applications";
import { createBookingFromRateCard, listRooms, resolveActiveRateCard } from "../../api/bookings";
import { listInstitutions } from "../../api/residents";
import { listLeasePeriods } from "../../api/setup";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatCard } from "../../components/common/StatCard";
import { PageHeader } from "../../components/layout/PageHeader";
import type { AcademicSession, Application, ApplicationStatus, IdentityDocument, Institution, LeasePeriod, RateCard, Resident, Room } from "../../types/api";
import { formatStatus } from "../../utils/format";

const pageSize = 25;
const statuses: Array<ApplicationStatus | "all"> = ["all", "draft", "submitted", "under_review", "approved", "rejected", "cancelled", "archived"];

export function ApplicationsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.role, "application:write");
  const canCreateAgreement = hasPermission(user?.role, "admin:write");
  const [applications, setApplications] = useState<Application[]>([]);
  const [residentsById, setResidentsById] = useState<Map<number, Resident>>(new Map());
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [documents, setDocuments] = useState<IdentityDocument[]>([]);
  const [restrictedResidentIds, setRestrictedResidentIds] = useState<number[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = (searchParams.get("status") ?? "all") as ApplicationStatus | "all";
  const queue = searchParams.get("queue") ?? "";
  const sessionFilter = searchParams.get("academicSessionId") ?? "all";
  const periodFilter = searchParams.get("leasePeriodId") ?? "";
  const submittedSearch = searchParams.get("search") ?? "";
  const offset = Number(searchParams.get("offset") ?? 0) || 0;
  const recordId = Number(searchParams.get("record") ?? 0);
  const [search, setSearch] = useState(submittedSearch);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<ApplicationStatus | null>(null);
  const [leasePeriods, setLeasePeriods] = useState<LeasePeriod[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);
  const [agreementSaving, setAgreementSaving] = useState(false);
  const [resolvedRate, setResolvedRate] = useState<RateCard | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [resolvingRate, setResolvingRate] = useState(false);
  const [, setSelectedLeasePeriodId] = useState<number | null>(null);
  const [, setSelectedRoomId] = useState<number | null>(null);

  function writeQuery(next: Record<string, string | null>) {
    const copy = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") copy.delete(key);
      else copy.set(key, value);
    }
    setSearchParams(copy);
  }

  async function load(nextOffset = offset, nextSearch = submittedSearch, nextStatus = statusFilter, nextSession = sessionFilter) {
    setLoading(true);
    setError(null);
    try {
      const [{ applications: rows, counts: nextCounts }, institutionRows, sessionRows, documentList, leasePeriodRows, roomRows] = await Promise.all([
        listApplications({ limit: pageSize, offset: nextOffset, search: nextSearch || undefined, status: nextStatus, queue: queue || undefined, academicSessionId: nextSession, leasePeriodId: periodFilter || undefined }),
        listInstitutions(),
        listAcademicSessions(),
        listIdentityDocuments(),
        listLeasePeriods(),
        listRooms()
      ]);
      const residentEntries = await Promise.all(
        Array.from(new Set(rows.map((application) => application.resident_id))).map(async (id) => [id, await getResident(id)] as const)
      );
      setApplications(rows);
      setCounts(nextCounts ?? null);
      setResidentsById(new Map(residentEntries));
      setInstitutions(institutionRows);
      setSessions(sessionRows);
      setDocuments(documentList.documents);
      setRestrictedResidentIds(documentList.restrictedResidentIds);
      setLeasePeriods(leasePeriodRows);
      setRooms(roomRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter, queue, sessionFilter, periodFilter, submittedSearch, offset]);

  useEffect(() => {
    if (!Number.isInteger(recordId) || recordId <= 0) return;
    let alive = true;
    setRecordError(null);
    setDetailLoading(true);
    getApplication(recordId).then((application) => {
      if (!alive) return;
      setSelected(application);
    }).catch(() => {
      if (alive) setRecordError("This record is no longer available.");
    }).finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [recordId]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    writeQuery({ search: search.trim() || null, offset: null });
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
        <StatCard label="Matching records" value={counts?.total ?? applications.length} helper="Full authorized set for this scope" />
        <StatCard label="Awaiting review" value={counts?.awaiting_review ?? "—"} />
        <StatCard label="Drafts" value={counts?.drafts ?? "—"} helper="Not included in awaiting review" />
        <StatCard label="Approved" value={counts?.approved ?? "—"} tone="success" />
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
            <select id="application-status" value={statusFilter} onChange={(event) => writeQuery({ status: event.target.value, queue: null, offset: null })} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              {statuses.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : formatStatus(status)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="application-session" className="block text-sm font-medium text-text-primary">Academic session</label>
            <select id="application-session" value={sessionFilter} onChange={(event) => writeQuery({ academicSessionId: event.target.value, offset: null })} className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="all">All sessions</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-text-primary hover:bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">Search</button>
        </form>
        <p className="mt-2 text-xs text-text-secondary">Status, queue, session, and search are applied on the server for the full authorized set. {queue ? `Queue: ${queue.replaceAll("_", " ")}.` : ""}</p>
      </section>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Loading applications..." /> : applications.length ? (
        <ApplicationTable applications={applications} residentsById={residentsById} institutions={institutions} sessions={sessions} onView={(application) => void openDetail(application)} />
      ) : (
        <EmptyState title={submittedSearch || statusFilter !== "all" || sessionFilter !== "all" ? "No matching applications" : "No applications"} message={submittedSearch || statusFilter !== "all" || sessionFilter !== "all" ? "No applications match the current search or filters." : "Applications will appear here after residents submit them."} />
      )}

      <div className="flex items-center justify-between">
        <button type="button" disabled={offset === 0 || loading} onClick={() => writeQuery({ offset: String(Math.max(0, offset - pageSize)) })} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <p className="text-sm text-text-secondary">Showing {applications.length ? offset + 1 : 0}-{offset + applications.length}</p>
        <button type="button" disabled={applications.length < pageSize || loading} onClick={() => writeQuery({ offset: String(offset + pageSize) })} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </div>

      <ConfirmDialog open={Boolean(selected) || detailLoading || Boolean(recordError)} title="Application Details" onClose={() => { setSelected(null); setRecordError(null); setDecisionStatus(null); setTransitionError(null); setAgreementOpen(false); writeQuery({ record: null }); }}>
        {recordError ? <ErrorState title="Record unavailable" message={recordError} /> : detailLoading || !selected ? <LoadingState label="Loading application..." /> : (
          <ApplicationDetail
            application={selected}
            resident={selectedResident}
            institution={selectedInstitution}
            session={selectedSession}
            leasePeriods={leasePeriods}
            documents={selectedDocuments}
            hasRestrictedDocuments={selected ? restrictedResidentIds.includes(selected.resident_id) : false}
            canManage={canManage}
            canCreateAgreement={canCreateAgreement}
            pending={pendingStatus || agreementSaving}
            onAction={requestAction}
            onCreateAgreement={() => { setAgreementError(null); setAgreementOpen(true); }}
          />
        )}
      </ConfirmDialog>

      {selected ? (
        <CreateAgreementDialog
          open={agreementOpen}
          application={selected}
          leasePeriods={leasePeriods}
          rooms={rooms}
          residentGender={selectedResident ? selectedResident.gender ?? null : undefined}
          resolvingRate={resolvingRate}
          resolvedRate={resolvedRate}
          rateError={rateError}
          error={agreementError}
          saving={agreementSaving}
          onLeasePeriodChange={setSelectedLeasePeriodId}
          onRoomChange={setSelectedRoomId}
          onResolveRate={(leasePeriodId, occupancyCapacity) => {
            void (async () => {
              setResolvingRate(true);
              setRateError(null);
              setResolvedRate(null);
              try {
                const card = await resolveActiveRateCard(leasePeriodId, occupancyCapacity);
                setResolvedRate(card);
              } catch (err) {
                setRateError(err instanceof Error ? err.message : "No active rate configured");
              } finally {
                setResolvingRate(false);
              }
            })();
          }}
          onCreate={(input) => {
            void (async () => {
              setAgreementSaving(true);
              setAgreementError(null);
              try {
                await createBookingFromRateCard({
                  applicationId: selected.id,
                  roomId: input.roomId,
                  leasePeriodId: input.leasePeriodId,
                  occupancyCapacity: input.occupancyCapacity,
                  maintenanceFeeMinor: input.maintenanceFeeMinor,
                  agreedAmountMinor: input.agreedAmountMinor,
                  overrideReason: input.overrideReason,
                  startsOn: input.startsOn,
                  endsOn: input.endsOn
                });
                setAgreementOpen(false);
              } catch (err) {
                setAgreementError(err instanceof Error ? err.message : "Unable to create agreement.");
              } finally {
                setAgreementSaving(false);
              }
            })();
          }}
          onClose={() => { if (!agreementSaving) setAgreementOpen(false); }}
        />
      ) : null}

      <DecisionDialog open={Boolean(decisionStatus)} status={decisionStatus} pending={pendingStatus} error={transitionError} onCancel={() => { if (!pendingStatus) { setDecisionStatus(null); setTransitionError(null); } }} onConfirm={(notes) => void confirmAction(notes)} />
    </div>
  );
}
