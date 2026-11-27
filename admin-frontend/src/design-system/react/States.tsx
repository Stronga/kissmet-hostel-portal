import type { ReactNode } from "react";
import { Button } from "./Button";

export function EmptyState({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <div className="km-empty" role="status">
      <h2 className="km-empty__title">{title}</h2>
      <p className="km-empty__message">{message}</p>
      {children}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="km-loading" role="status">
      <span className="km-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div className="km-skeleton-stack" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="km-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="km-error" role="alert">
      <p className="km-error__title">{title}</p>
      {message ? <p className="km-error__message">{message}</p> : null}
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}
