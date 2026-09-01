import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`rounded-token border border-border bg-surface p-5 shadow-token ${className}`} {...props} />;
}
