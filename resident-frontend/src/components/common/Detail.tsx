import type { ReactNode } from "react";

interface DetailProps {
  label: string;
  value?: string | number | null;
  help?: ReactNode;
  helpLabel?: string;
}

export function Detail({ label, value, help, helpLabel }: DetailProps) {
  return (
    <div className="min-w-0">
      <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        <span>{label}</span>
        {help ? help : null}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-text-primary">{value || "Not available"}</p>
      {helpLabel ? <span className="sr-only">{helpLabel}</span> : null}
    </div>
  );
}
