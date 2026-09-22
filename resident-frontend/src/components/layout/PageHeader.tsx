import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional trailing control (e..g. mobile status pill). */
  trailing?: ReactNode;
}

export function PageHeader({ title, description, trailing }: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:mb-8">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold text-text-primary sm:text-[26px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-text-secondary">{description}</p> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
