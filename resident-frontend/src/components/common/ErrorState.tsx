import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ title = "Something went wrong", message, onRetry, retryLabel = "Retry" }: ErrorStateProps) {
  return (
    <div className="rounded-token border border-danger/30 bg-[#fff5f4] p-4 text-sm text-danger" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {onRetry ? (
        <Button className="mt-3" variant="secondary" type="button" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
