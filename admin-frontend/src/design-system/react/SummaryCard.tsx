import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function SummaryCard({
  label,
  value,
  helper,
  tone = "neutral",
  href,
  onClick
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: Tone;
  href?: string;
  onClick?: () => void;
}) {
  const className = tone === "neutral" ? "km-card" : `km-card km-card--${tone}`;
  const body = (
    <>
      <p className="km-card__label">{label}</p>
      <p className="km-card__value">{value}</p>
      {helper ? <p className="km-card__helper">{helper}</p> : null}
    </>
  );

  if (href) {
    return (
      <a className={`${className} km-card--button`} href={href}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={`${className} km-card--button`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <section className={className}>{body}</section>;
}
