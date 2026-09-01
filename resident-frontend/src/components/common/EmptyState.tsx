export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-token border border-dashed border-border bg-surface p-6 text-center">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 text-sm text-text-secondary">{message}</p>
    </div>
  );
}
