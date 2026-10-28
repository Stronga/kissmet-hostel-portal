import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { Detail } from "../../components/common/Detail";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { InfoHelp } from "../../components/common/InfoHelp";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { ResidentShellOutletContext } from "../../components/layout/ResidentShell";
import { createResidentApplication, fetchActiveAcademicSession, fetchActiveLeasePeriods, fetchResidentApplications, fetchResidentDocuments, fetchResidentProfile, submitResidentApplication } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { AcademicSession, LeaseKind, ResidentApplication, ResidentDocument, ResidentLeasePeriod, ResidentProfile } from "../../types/resident";
import { applicationStatusDescription, applicationStatusLabel, buildReadiness, isReadyToSubmit, latestApplication } from "../../utils/application";
import { formatDateTime } from "../../utils/format";

interface PageData {
  profile: ResidentProfile;
  documents: ResidentDocument[];
  applications: ResidentApplication[];
  activeSession: AcademicSession | null;
  leasePeriods: ResidentLeasePeriod[];
}

function leaseKindLabel(kind?: string | null) {
  if (kind === "calendar_year") return "Calendar Year";
  if (kind === "short_term") return "Short-Term";
  if (kind === "academic_calendar") return "Academic Calendar";
  return "Not set";
}

function statusHelp(application?: ResidentApplication | null) {
  if (!application) return "Start a hostel application for the active academic session.";
  if (application.status === "approved") {
    return "Approval means you are eligible for booking. It does not assign a room, create a payment, or confirm accommodation by itself.";
  }
  if (application.status === "draft") return "Review your readiness checklist and submit when everything is complete.";
  if (application.status === "submitted") return "Your application has been submitted and is waiting for review.";
  if (application.status === "under_review") return "Kissmet staff are reviewing your application.";
  if (application.status === "rejected") return "Your application was not approved.";
  if (application.status === "archived") return "This application is archived.";
  if (application.status === "cancelled") return "This application was cancelled.";
  return applicationStatusDescription(application);
}

function Timeline({ application }: { application: ResidentApplication }) {
  const events = [
    { label: "Application created", at: application.created_at },
    { label: "Submitted", at: application.submitted_at },
    { label: application.status === "rejected" ? "Decision recorded" : application.status === "approved" ? "Approved" : "Reviewed", at: application.reviewed_at }
  ].filter((event) => event.at);

  return (
    <Card>
      <h2 className="text-lg font-bold text-text-primary">Timeline</h2>
      {events.length ? (
        <ol className="relative mt-5 space-y-0" aria-label="Application timeline">
          {events.map((event, index) => (
            <li key={`${event.label}-${event.at}`} className="relative flex gap-4 pb-5 last:pb-0">
              {index < events.length - 1 ? (
                <span className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-[#e2e8f0]" aria-hidden="true" />
              ) : null}
              <span className="relative z-[1] mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white" aria-hidden="true">
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold text-text-primary">{event.label}</p>
                <p className="mt-1 text-[13px] text-text-secondary">{formatDateTime(event.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-4">
          <EmptyState title="No timeline yet" message="Timeline entries appear only when the backend provides real timestamps." />
        </div>
      )}
    </Card>
  );
}

export function ApplicationPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accommodationType, setAccommodationType] = useState<LeaseKind>("academic_calendar");
  const [selectedLeasePeriodId, setSelectedLeasePeriodId] = useState<number | "">("");
  const createInFlight = useRef(false);
  const submitInFlight = useRef(false);
  usePageTitle("Application");
  const outletContext = useOutletContext<ResidentShellOutletContext | null>();

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [profile, documents, applications, activeSession, leasePeriods] = await Promise.all([
        fetchResidentProfile(),
        fetchResidentDocuments(),
        fetchResidentApplications(),
        fetchActiveAcademicSession(),
        fetchActiveLeasePeriods()
      ]);
      setData({
        profile: profile.data,
        documents: documents.data,
        applications: applications.data,
        activeSession: activeSession.data,
        leasePeriods: leasePeriods.data
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load application.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!outletContext?.setChromeStatus) return;
    outletContext.setChromeStatus(data?.profile.status ?? null);
    return () => outletContext.setChromeStatus(null);
  }, [data?.profile.status, outletContext]);

  const currentApplication = useMemo(() => latestApplication(data?.applications ?? []), [data?.applications]);
  const readiness = useMemo(() => data ? buildReadiness(data.profile, data.documents) : [], [data]);
  const readyToSubmit = data ? isReadyToSubmit(data.profile, data.documents) : false;
  const canSubmit = currentApplication?.status === "draft" && readyToSubmit;
  const periodsForType = useMemo(
    () => (data?.leasePeriods ?? []).filter((period) => period.kind === accommodationType),
    [data?.leasePeriods, accommodationType]
  );
  const canCreate = Boolean(!currentApplication && (selectedLeasePeriodId || (accommodationType === "academic_calendar" && data?.activeSession)));

  async function createDraft() {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setIsCreating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      if (selectedLeasePeriodId) {
        await createResidentApplication({ leasePeriodId: Number(selectedLeasePeriodId) });
      } else if (accommodationType === "academic_calendar" && data?.activeSession) {
        await createResidentApplication({ academicSessionId: data.activeSession.id });
      } else {
        throw new Error("Select an available lease period for this accommodation type.");
      }
      setActionSuccess("Draft application created.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to create application.");
    } finally {
      createInFlight.current = false;
      setIsCreating(false);
    }
  }

  async function submitDraft() {
    if (!currentApplication || submitInFlight.current) return;
    if (!window.confirm("Submit this application for staff review?")) return;
    submitInFlight.current = true;
    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await submitResidentApplication(currentApplication.id);
      setActionSuccess("Application submitted.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to submit application.");
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading application" />;
  if (error || !data) {
    return <ErrorState title="Application unavailable" message={error ?? "Unable to load application."} onRetry={() => void load()} />;
  }

  const shortStatus =
    currentApplication?.status === "approved"
      ? "Your application has been approved."
      : applicationStatusDescription(currentApplication);
  const showRejectedNotes = currentApplication?.status === "rejected";

  return (
    <>
      <PageHeader
        title="Application"
        description="Request accommodation for Academic Calendar, Calendar Year, or Short-Term lease periods."
        trailing={<div className="xl:hidden"><StatusBadge status={data.profile.status} /></div>}
      />
      {actionError ? <div className="mb-5"><ErrorState title="Action failed" message={actionError} /></div> : null}
      {actionSuccess ? <div className="mb-5 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">{actionSuccess}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1 text-sm font-semibold text-text-secondary">
                Accommodation type
                <InfoHelp label="About accommodation types">
                  Choose Academic Calendar, Calendar Year, or Short-Term. Calendar Year and Short-Term do not require an academic session.
                </InfoHelp>
              </p>
              <h2 className="mt-1 text-xl font-bold text-text-primary">
                {currentApplication ? leaseKindLabel(currentApplication.lease_kind) : "Start an application"}
              </h2>
              <p className="mt-1 text-[13px] text-text-secondary">
                {currentApplication
                  ? (currentApplication.academic_session_id == null ? "No academic session required for this application." : (data.activeSession?.name ?? `Session #${currentApplication.academic_session_id}`))
                  : "Select an accommodation type and available lease period."}
              </p>
            </div>
            {currentApplication ? (
              <span className="inline-flex items-center gap-1">
                <StatusBadge status={applicationStatusLabel(currentApplication.status)} />
                <InfoHelp label="About application status">{statusHelp(currentApplication)}</InfoHelp>
              </span>
            ) : null}
          </div>

          {!currentApplication ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-text-primary">
                Accommodation Type
                <select
                  className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm"
                  value={accommodationType}
                  onChange={(event) => {
                    setAccommodationType(event.target.value as LeaseKind);
                    setSelectedLeasePeriodId("");
                  }}
                >
                  <option value="academic_calendar">Academic Calendar</option>
                  <option value="calendar_year">Calendar Year</option>
                  <option value="short_term">Short-Term</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-text-primary">
                Lease period
                <select
                  className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm"
                  value={selectedLeasePeriodId}
                  onChange={(event) => setSelectedLeasePeriodId(event.target.value ? Number(event.target.value) : "")}
                >
                  <option value="">Select lease period</option>
                  {periodsForType.map((period) => (
                    <option key={period.id} value={period.id}>{period.name} ({period.code})</option>
                  ))}
                </select>
              </label>
              {accommodationType === "academic_calendar" ? (
                <p className="sm:col-span-2 text-[13px] text-text-secondary">
                  Active academic session context: {data.activeSession?.name ?? "No active academic session (select a lease period linked to a session)."}.
                </p>
              ) : (
                <p className="sm:col-span-2 text-[13px] text-text-secondary">
                  Calendar Year and Short-Term applications do not require an academic session.
                </p>
              )}
            </div>
          ) : null}

          {currentApplication ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Detail label="Application number" value={currentApplication.application_number} />
              <Detail label="Status" value={applicationStatusLabel(currentApplication.status)} />
              <Detail label="Created" value={formatDateTime(currentApplication.created_at)} />
              <Detail label="Submitted" value={formatDateTime(currentApplication.submitted_at)} />
              <Detail label="Reviewed" value={formatDateTime(currentApplication.reviewed_at)} />
              <Detail label="Lease type" value={leaseKindLabel(currentApplication.lease_kind)} />
              <Detail label="Academic session" value={currentApplication.academic_session_id == null ? "Not applicable" : (data.activeSession?.name ?? `Session #${currentApplication.academic_session_id}`)} />
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState title="No application yet" message="Choose an accommodation type and lease period, then start a draft when you are ready." />
            </div>
          )}

          {currentApplication ? (
            <div className="mt-5 rounded-2xl border border-border bg-[#f7f9fa] p-4">
              <p className="text-sm font-semibold text-text-primary">{shortStatus}</p>
              {showRejectedNotes ? (
                <p className="mt-2 text-sm text-text-secondary">
                  {currentApplication.decision_notes || "Your application was not approved. Contact hostel management if you need more information."}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {!currentApplication ? (
              <Button disabled={!canCreate || isCreating} onClick={() => void createDraft()}>
                {isCreating ? "Starting..." : "Start application"}
              </Button>
            ) : currentApplication.status === "draft" ? (
              <Button disabled={!canSubmit || isSubmitting} onClick={() => void submitDraft()}>
                {isSubmitting ? "Submitting..." : "Submit application"}
              </Button>
            ) : null}
            {!readyToSubmit && currentApplication?.status === "draft" ? (
              <Link to="/documents" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">
                Complete requirements
              </Link>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="inline-flex items-center gap-1 text-lg font-bold text-text-primary">
            Readiness checklist
            <InfoHelp label="About readiness checklist">
              Phone verification, profile details, and required identity documents must be complete before you can submit. Student Card is required for students only; Ghana Card is always required.
            </InfoHelp>
          </h2>
          <ul className="mt-4 space-y-2.5" aria-label="Application readiness checklist">
            {readiness.map((item) => (
              <li key={item.key} className="flex items-start gap-3 rounded-xl border border-border bg-white p-3">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.ready ? "bg-[#dcf1e9] text-[#127b55]" : "bg-red-50 text-danger"}`}
                  aria-hidden="true"
                >
                  {item.ready ? "✓" : "!"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                  <p className="mt-0.5 text-[13px] text-text-secondary">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {currentApplication ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Timeline application={currentApplication} />
          <Card>
            <h2 className="text-lg font-bold text-text-primary">Application history</h2>
            {data.applications.length > 1 ? (
              <div className="mt-4 space-y-3">
                {data.applications.map((application) => (
                  <div key={application.id} className="rounded-xl border border-border bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">{application.application_number}</p>
                      <StatusBadge status={applicationStatusLabel(application.status)} />
                    </div>
                    <p className="mt-1 text-[13px] text-text-secondary">Created {formatDateTime(application.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState title="No previous applications" message="Application history will appear here when the backend exposes more than one resident application." />
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
