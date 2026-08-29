export function LoadingState({ label = "Loading...", fullScreen = false }: { label?: string; fullScreen?: boolean }) {
  return (
    <div className={fullScreen ? "flex min-h-screen items-center justify-center bg-background" : "rounded-token border border-border bg-surface p-6"}>
      <div className="flex items-center gap-3 text-sm text-text-secondary">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  );
}
