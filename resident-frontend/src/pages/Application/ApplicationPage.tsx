import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { createResidentApplication, fetchActiveAcademicSession, fetchResidentApplications, fetchResidentDocuments, fetchResidentProfile, submitResidentApplication } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { AcademicSession, ResidentApplication, ResidentDocument, ResidentProfile } from "../../types/resident";
import { applicationStatusDescription, applicationStatusLabel, buildReadiness, isReadyToSubmit, latestApplication } from "../../utils/application";
import { formatDateTime } from "../../utils/format";

interface PageData {
  profile: ResidentProfile;
  documents: ResidentDocument[];
  applications: ResidentApplication[];
  activeSession: AcademicSession | null;
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 break-anywhere text-sm font-semibold text-text-primary">{value || "Unavailable"}</p>
    </div>
  );
}

function Timeline({ application }: { application: ResidentApplication }) {
  const events = [
    { label: "Application created", at: application.created_at },
    { label: "Submitted", at: application.submitted_at },
    { label: application.status === "rejected" ? "Decision recorded" : application.status === "approved" ? "Approved" : "Reviewed", at: application.reviewed_at }
  ].filter((event) => event.at);

  return (
    <Card>
      <h2 className="text-lg font-semibold text-text-primary">Timeline</h2>
      {events.length ? (
        <ol className="mt-4 space-y-3" aria-label="Application timeline">
          {events.map((event) => (
            <li key={`${event.label}-${event.at}`} className="rounded-token border border-border bg-white p-3">
              <p className="text-sm font-semibold text-text-primary">{event.label}</p>
              <p className="mt-1 text-sm text-text-secondary">{formatDateTime(event.at)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="No timeline yet" message="Timeline entries appear only when the backend provides real timestamps." />
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
  const createInFlight = useRef(false);
  const submitInFlight = useRef(false);
  usePageTitle("Application");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [profile, documents, applications, activeSession] = await Promise.all([
        fetchResidentProfile(),
        fetchResidentDocuments(),
        fetchResidentApplications(),
        fetchActiveAcademicSession()
      ]);
      setData({
        profile: profile.data,
        documents: documents.data,
        applications: applications.data,
        activeSession: activeSession.data
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load application.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const currentApplication = useMemo(() => latestApplication(data?.applications ?? []), [data?.applications]);
  const readiness = useMemo(() => data ? buildReadiness(data.profile, data.documents) : [], [data]);
  const readyToSubmit = data ? isReadyToSubmit(data.profile, data.documents) : false;
  const canSubmit = currentApplication?.status === "draft" && readyToSubmit;
  const canCreate = Boolean(data?.activeSession && !currentApplication);

  async function createDraft() {
    if (!data?.activeSession || createInFlight.current) return;
    createInFlight.current = true;
    setIsCreating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await createResidentApplication(data.activeSession.id);
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

  return (
    <>
      <PageHeader title="Application" description="Request accommodation consideration for the active academic session." />
      {actionError ? <div className="mb-5"><ErrorState title="Action failed" message={actionError} /></div> : null}
      {actionSuccess ? <div className="mb-5 rounded-token border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">{actionSuccess}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-secondary">Current academic session</p>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{data.activeSession?.name ?? "No active session"}</h2>
              <p className="mt-1 text-sm text-text-secondary">{data.activeSession ? data.activeSession.code : "Applications cannot be started until a session is active."}</p>
            </div>
            {currentApplication ? <StatusBadge status={applicationStatusLabel(currentApplication.status)} /> : null}
          </div>

          {currentApplication ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Detail label="Application number" value={currentApplication.application_number} />
              <Detail label="Status" value={applicationStatusLabel(currentApplication.status)} />
              <Detail label="Created" value={formatDateTime(currentApplication.created_at)} />
              <Detail label="Submitted" value={formatDateTime(currentApplication.submitted_at)} />
              <Detail label="Reviewed" value={formatDateTime(currentApplication.reviewed_at)} />
              <Detail label="Academic session" value={data.activeSession?.name ?? `Session #${currentApplication.academic_session_id}`} />
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState title="No application yet" message="Start a draft application for the current active academic session when you are ready." />
            </div>
          )}

          <div className="mt-5 rounded-token border border-border bg-muted/50 p-4">
            <p className="text-sm font-semibold text-text-primary">{applicationStatusDescription(currentApplication)}</p>
            {currentApplication?.status === "approved" ? <p className="mt-2 text-sm text-text-secondary">Approval means you are eligible for booking. It does not assign a room, create a payment, or confirm accommodation by itself.</p> : null}
            {currentApplication?.status === "rejected" ? <p className="mt-2 text-sm text-text-secondary">{currentApplication.decision_notes || "Your application was not approved. Contact hostel management if you need more information."}</p> : null}
          </div>

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
            {!readyToSubmit && currentApplication?.status === "draft" ? <Link to="/documents" className="inline-flex min-h-11 items-center justify-center rounded-token border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">Complete requirements</Link> : null}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-text-primary">Readiness checklist</h2>
          <ul className="mt-4 space-y-3" aria-label="Application readiness checklist">
            {readiness.map((item) => (
              <li key={item.key} className="rounded-token border border-border bg-white p-3">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.ready ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`} aria-hidden="true">
                    {item.ready ? "✓" : "!"}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                    <p className="mt-1 text-sm text-text-secondary">{item.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {currentApplication ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Timeline application={currentApplication} />
          <Card>
            <h2 className="text-lg font-semibold text-text-primary">Application history</h2>
            {data.applications.length > 1 ? (
              <div className="mt-4 space-y-3">
                {data.applications.map((application) => (
                  <div key={application.id} className="rounded-token border border-border bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">{application.application_number}</p>
                      <StatusBadge status={applicationStatusLabel(application.status)} />
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">Created {formatDateTime(application.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No previous applications" message="Application history will appear here when the backend exposes more than one resident application." />
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
