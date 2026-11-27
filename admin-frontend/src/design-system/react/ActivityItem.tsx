import type { ReactNode } from "react";

export function ActivityItem({
  title,
  detail,
  meta,
  unread = false,
  unresolved = false,
  href,
  onClick
}: {
  title: string;
  detail?: ReactNode;
  meta?: ReactNode;
  unread?: boolean;
  unresolved?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = unread ? "km-activity km-activity--unread" : "km-activity";
  const body = (
    <>
      <p className="km-activity__title">{title}</p>
      {detail ? <p className="km-activity__detail">{detail}</p> : null}
      <div className="km-activity__flags">
        {unread ? <span className="km-badge km-badge--info">Unread</span> : null}
        {unresolved ? <span className="km-badge km-badge--warning">Unresolved</span> : null}
        {meta ? <span className="km-activity__meta">{meta}</span> : null}
      </div>
    </>
  );
  if (href) return <a className={className} href={href}>{body}</a>;
  if (onClick) return <button type="button" className={className} onClick={onClick}>{body}</button>;
  return <article className={className}>{body}</article>;
}
