import { useId, useRef, type ReactNode } from "react";
import { useDialogBehavior } from "./focus";

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  side = "right",
  hideTitle = false,
  className
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  side?: "left" | "right";
  hideTitle?: boolean;
  className?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  useDialogBehavior(open, onClose, panelRef);
  if (!open) return null;

  return (
    <div className={className ? `km-drawer ${className}` : "km-drawer"}>
      <button type="button" className="km-drawer__backdrop" aria-label="Close dialog" tabIndex={-1} onClick={onClose} />
      <aside
        ref={panelRef}
        className={`km-drawer__panel km-drawer__panel--${side}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="km-drawer__header">
          <div>
            <h2 id={titleId} className={hideTitle ? "km-sr-only" : "km-drawer__title"}>{title}</h2>
            {description ? <p id={descriptionId} className="km-drawer__description">{description}</p> : null}
          </div>
          <button type="button" className="km-btn km-btn--ghost km-btn--icon" aria-label="Close" data-autofocus onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="km-drawer__body">{children}</div>
      </aside>
    </div>
  );
}
