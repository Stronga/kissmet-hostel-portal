import type { Application, ApplicationStatus } from "../../types/api";
import { formatStatus } from "../../utils/format";

export function availableApplicationActions(status: ApplicationStatus): ApplicationStatus[] {
  const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
    draft: ["submitted", "cancelled", "archived"],
    submitted: ["under_review", "cancelled"],
    under_review: ["approved", "rejected"],
    approved: ["archived"],
    rejected: ["archived"],
    cancelled: ["archived"],
    archived: []
  };
  return transitions[status] ?? [];
}

function actionLabel(status: ApplicationStatus) {
  if (status === "under_review") return "Start Review";
  if (status === "submitted") return "Submit";
  if (status === "approved") return "Approve";
  if (status === "rejected") return "Reject";
  if (status === "cancelled") return "Cancel";
  if (status === "archived") return "Archive";
  return formatStatus(status);
}

export function ApplicationReviewActions({
  application,
  canManage,
  pending,
  onAction
}: {
  application: Application;
  canManage: boolean;
  pending: boolean;
  onAction: (status: ApplicationStatus) => void;
}) {
  if (!canManage) return <p className="text-sm text-text-secondary">You can review application details, but this role cannot change application status.</p>;

  const actions = availableApplicationActions(application.status);
  if (!actions.length) return <p className="text-sm text-text-secondary">No further status actions are available for this application.</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((status) => (
        <button
          key={status}
          type="button"
          disabled={pending}
          onClick={() => onAction(status)}
          className={status === "approved" ? "rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50" : "rounded-md border border-border px-3 py-2 text-sm font-semibold text-text-primary hover:bg-muted disabled:opacity-50"}
        >
          {actionLabel(status)}
        </button>
      ))}
    </div>
  );
}
