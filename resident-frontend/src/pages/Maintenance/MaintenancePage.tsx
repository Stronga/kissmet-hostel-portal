import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { Detail } from "../../components/common/Detail";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { InfoHelp } from "../../components/common/InfoHelp";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { createResidentMaintenance, fetchResidentMaintenance } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { MaintenanceCategory, MaintenancePriority, ResidentMaintenanceRequest } from "../../types/resident";
import { formatDateTime } from "../../utils/format";
import { maintenanceCategories, maintenanceCategoryLabel, maintenanceLocation, maintenancePriorities, maintenancePriorityLabel, maintenanceStatusLabel, splitMaintenanceRequests } from "../../utils/maintenance";

function RequestCard({ request }: { request: ResidentMaintenanceRequest }) {
  return (
    <article className="rounded-xl border border-border bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-primary">{request.request_number}</p>
          <h3 className="mt-1 text-base font-semibold text-text-primary">{request.title}</h3>
          <p className="mt-1 text-[13px] text-text-secondary">{maintenanceCategoryLabel(request.category)} / {maintenancePriorityLabel(request.priority)} priority</p>
        </div>
        <span className="inline-flex items-center gap-1">
          <StatusBadge status={maintenanceStatusLabel(request.status)} />
          <InfoHelp label="About maintenance status">
            Open, assigned, and in-progress requests are active. Resolved, closed, cancelled, and archived requests move to history.
          </InfoHelp>
        </span>
      </div>
      {request.description ? <p className="mt-3 text-sm text-text-secondary">{request.description}</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Location" value={maintenanceLocation(request)} />
        <Detail label="Submitted" value={formatDateTime(request.opened_at)} />
        <Detail label="Assigned" value={formatDateTime(request.assigned_at)} />
        <Detail label="Started" value={formatDateTime(request.started_at)} />
        <Detail label="Resolved" value={formatDateTime(request.resolved_at)} />
        <Detail label="Closed" value={formatDateTime(request.closed_at)} />
      </div>
    </article>
  );
}

export function MaintenancePage() {
  const [requests, setRequests] = useState<ResidentMaintenanceRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>("plumbing");
  const [priority, setPriority] = useState<MaintenancePriority>("normal");
  const [description, setDescription] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlight = useRef(false);
  usePageTitle("Maintenance");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchResidentMaintenance();
      setRequests(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load maintenance requests.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const grouped = useMemo(() => splitMaintenanceRequests(requests), [requests]);
  const titleError = title.trim() ? null : "Issue title is required.";

  async function submit() {
    if (inFlight.current) return;
    setActionError(null);
    setActionSuccess(null);
    if (titleError) {
      setActionError(titleError);
      return;
    }
    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const created = await createResidentMaintenance({ category, priority, title: title.trim(), description: description.trim() || null });
      setTitle("");
      setDescription("");
      setCategory("plumbing");
      setPriority("normal");
      setActionSuccess(`Maintenance request ${created.data.request_number} created.`);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to create maintenance request.");
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading maintenance requests" />;
  if (error) {
    return <ErrorState title="Maintenance unavailable" message={error} onRetry={() => void load()} />;
  }

  return (
    <>
      <PageHeader title="Maintenance" description="Report and track hostel maintenance issues." />
      {actionError ? <div className="mb-5"><ErrorState title="Request not submitted" message={actionError} /></div> : null}
      {actionSuccess ? <div className="mb-5 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">{actionSuccess}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="text-lg font-bold text-text-primary">Report a maintenance issue</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-text-primary" htmlFor="maintenance-title">Issue title</label>
              <input id="maintenance-title" className="mt-2 min-h-11 w-full rounded-xl border border-border px-3 py-3 text-sm" disabled={isSubmitting} autoComplete="off" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="Briefly describe the issue" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary" htmlFor="maintenance-category">Category</label>
              <select id="maintenance-category" className="mt-2 min-h-11 w-full rounded-xl border border-border px-3 py-3 text-sm" disabled={isSubmitting} value={category} onChange={(event) => setCategory(event.currentTarget.value as MaintenanceCategory)}>
                {maintenanceCategories.map((item) => <option key={item} value={item}>{maintenanceCategoryLabel(item)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary" htmlFor="maintenance-priority">Priority</label>
              <select id="maintenance-priority" className="mt-2 min-h-11 w-full rounded-xl border border-border px-3 py-3 text-sm" disabled={isSubmitting} value={priority} onChange={(event) => setPriority(event.currentTarget.value as MaintenancePriority)}>
                {maintenancePriorities.map((item) => <option key={item} value={item}>{maintenancePriorityLabel(item)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary" htmlFor="maintenance-description">Description</label>
              <textarea id="maintenance-description" className="mt-2 min-h-28 w-full rounded-xl border border-border px-3 py-3 text-sm" disabled={isSubmitting} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="Add details staff may need" />
            </div>
            <Button className="w-full rounded-full" disabled={isSubmitting} onClick={() => void submit()}>{isSubmitting ? "Submitting..." : "Submit request"}</Button>
            <p className="inline-flex items-start gap-1 text-xs text-text-secondary">
              <span>Kissmet generates the request number and links your current room when allocated.</span>
              <InfoHelp label="About maintenance requests">
                Kissmet generates the request number and links your current room or bed when an active allocation exists.
              </InfoHelp>
            </p>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-bold text-text-primary">Active requests</h2>
            {grouped.active.length ? (
              <div className="mt-4 space-y-3">
                {grouped.active.map((request) => <RequestCard key={request.id} request={request} />)}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState title="No active requests" message="Open, assigned, and in-progress requests will appear here." />
              </div>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-text-primary">Request history</h2>
            {grouped.history.length ? (
              <div className="mt-4 space-y-3">
                {grouped.history.map((request) => <RequestCard key={request.id} request={request} />)}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState title="No maintenance history" message="Resolved, closed, cancelled, and archived requests will appear here." />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
