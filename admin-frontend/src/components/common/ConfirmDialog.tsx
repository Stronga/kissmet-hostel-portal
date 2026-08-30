import type { ReactNode } from "react";
import { useId } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button className="absolute inset-0 bg-slate-900/45" aria-label="Close dialog" onClick={onClose} />
      <section className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-token border border-border bg-surface p-5 shadow-token">
        <div className="mb-4 border-b border-border pb-3">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary">{title}</h2>
          {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
        </div>
        {children}
      </section>
    </div>
  );
}
