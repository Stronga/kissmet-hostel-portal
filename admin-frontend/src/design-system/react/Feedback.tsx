import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "danger";

export function Banner({
  tone = "info",
  title,
  children,
  onDismiss
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  return (
    <div className={tone === "info" ? "km-banner" : `km-banner km-banner--${tone}`} role={role}>
      <div>
        {title ? <p className="km-banner__title">{title}</p> : null}
        <div className="km-banner__body">{children}</div>
      </div>
      {onDismiss ? (
        <button type="button" className="km-btn km-btn--ghost km-btn--icon" aria-label="Dismiss notification" onClick={onDismiss}>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

export function Toast(props: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className="km-toast">
      <Banner {...props} />
    </div>
  );
}
