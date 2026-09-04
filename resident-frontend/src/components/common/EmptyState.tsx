import { Link } from "react-router-dom";

interface EmptyStateProps {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}

export function EmptyState({ title, message, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <div className="rounded-token border border-dashed border-border bg-surface p-6 text-center">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 text-sm text-text-secondary">{message}</p>
      {actionHref && actionLabel ? (
        <Link
          to={actionHref}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-token bg-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
