export type WorkflowState = "complete" | "current" | "upcoming" | "blocked";

export function WorkflowSteps({
  label = "Progress",
  steps
}: {
  label?: string;
  steps: Array<{ id: string; label: string; state: WorkflowState; detail?: string }>;
}) {
  return (
    <ol className="km-steps" aria-label={label}>
      {steps.map((step) => (
        <li key={step.id} className="km-steps__item" data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="km-steps__label">{step.label}</span>
          <span className="km-steps__state">{step.state.replace("_", " ")}</span>
          {step.detail ? <span className="km-steps__detail">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}
