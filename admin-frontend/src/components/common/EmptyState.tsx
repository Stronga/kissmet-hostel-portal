export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-token border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{message}</p>
    </div>
  );
}
