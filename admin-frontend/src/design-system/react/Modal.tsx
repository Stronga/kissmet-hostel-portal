import { useId, useRef, type ReactNode } from "react";
import { useDialogBehavior } from "./focus";

interface ModalBase {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  showCloseButton?: boolean;
}

type ModalProps = ModalBase & (
  | { variant?: "default"; footer?: ReactNode }
  | {
      variant: "confirm";
      confirmLabel?: string;
      cancelLabel?: string;
      tone?: "primary" | "danger";
      onConfirm: () => void;
    }
);

export function Modal(props: ModalProps) {
  const { open, title, description, onClose, children, showCloseButton = true } = props;
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, onClose, panelRef);
  if (!open) return null;

  const footer = props.variant === "confirm" ? (
    <>
      <button type="button" className="km-btn km-btn--secondary" onClick={onClose}>
        {props.cancelLabel ?? "Cancel"}
      </button>
      <button
        type="button"
        className={props.tone === "danger" ? "km-btn km-btn--danger" : "km-btn km-btn--primary"}
        onClick={props.onConfirm}
      >
        {props.confirmLabel ?? "Confirm"}
      </button>
    </>
  ) : props.footer;

  return (
    <div className="km-modal">
      <button type="button" className="km-modal__backdrop" aria-label="Close dialog" tabIndex={-1} onClick={onClose} />
      <div
        ref={panelRef}
        className="km-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="km-modal__header">
          <div>
            <h2 id={titleId} className="km-modal__title">{title}</h2>
            {description ? <p id={descriptionId} className="km-modal__description">{description}</p> : null}
          </div>
          {showCloseButton ? (
            <button type="button" className="km-btn km-btn--ghost km-btn--icon" aria-label="Close" data-autofocus onClick={onClose}>
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </header>
        <div className="km-modal__body">{children}</div>
        {footer ? <footer className="km-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
