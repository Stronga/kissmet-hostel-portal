import { useEffect, useState } from "react";
import { getWorkflow, type WorkflowGuidance } from "../../api/activity";
import { LoadingState } from "../../design-system/react/States";
import { WorkflowSteps } from "../../design-system/react/WorkflowSteps";

export function GuidedWorkflow({ subjectType, subjectId }: { subjectType: string; subjectId: number }) {
  const [workflow, setWorkflow] = useState<WorkflowGuidance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getWorkflow(subjectType, subjectId)
      .then((result) => { if (alive) setWorkflow(result); })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : "Unable to load workflow guidance."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [subjectId, subjectType]);

  if (loading) return <LoadingState label="Loading workflow guidance" />;
  if (error) return <p className="text-sm text-text-secondary">Workflow guidance is unavailable. {error}</p>;
  if (!workflow) return null;
  if (!workflow.available) {
    return <p className="text-sm text-text-secondary">{workflow.unavailableReason ?? "This record is no longer available."}</p>;
  }

  return (
    <section className="rounded border border-border p-3" aria-label="Workflow guidance">
      <h3 className="text-sm font-semibold text-text-primary">Workflow</h3>
      <p className="mt-1 text-xs text-text-secondary">Current status: {workflow.status}. The next step stays an explicit confirmed action.</p>
      <div className="mt-3">
        <WorkflowSteps steps={workflow.steps.map((step) => ({ id: step.id, label: step.label, state: step.state, detail: step.detail ?? undefined }))} />
      </div>
      {workflow.nextAction ? (
        <p className="mt-3 text-sm text-text-primary">
          Next required action: <strong>{workflow.nextAction.label}</strong>
          {workflow.responsibleRole ? `. Responsible role: ${workflow.responsibleRole}.` : "."}
          {workflow.nextAction.blockedReason ? ` Blocked: ${workflow.nextAction.blockedReason}` : ""}
        </p>
      ) : <p className="mt-3 text-sm text-text-secondary">No further action is required for this status.</p>}
      {workflow.blockers.length ? <ul className="mt-2 list-disc pl-5 text-sm text-text-primary">{workflow.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
      {workflow.dependencies?.length ? <p className="mt-2 text-xs text-text-secondary">{workflow.dependencies.join(" ")}</p> : null}
    </section>
  );
}
