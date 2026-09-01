export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-token border border-border bg-surface p-6 text-sm text-text-secondary" role="status">
      {label}
    </div>
  );
}
