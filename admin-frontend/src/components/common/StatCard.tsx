export function StatCard({ label, value, helper, tone = "default" }: { label: string; value: string | number; helper?: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneClass = {
    default: "border-border",
    success: "border-emerald-200",
    warning: "border-amber-200",
    danger: "border-red-200"
  }[tone];

  return (
    <section className={`rounded-token border ${toneClass} bg-surface p-4 shadow-sm`}>
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text-primary">{value}</p>
      {helper ? <p className="mt-1 text-xs text-text-secondary">{helper}</p> : null}
    </section>
  );
}
