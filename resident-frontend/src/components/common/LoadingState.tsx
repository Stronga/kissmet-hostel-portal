export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex min-h-48 items-center justify-center rounded-3xl border border-[#eaeff2] bg-surface p-6 text-sm text-text-secondary shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
      role="status"
    >
      {label}
    </div>
  );
}
