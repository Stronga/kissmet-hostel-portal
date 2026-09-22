import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={`rounded-3xl border border-[#eaeff2] bg-surface p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:p-6 ${className}`}
      {...props}
    />
  );
}
