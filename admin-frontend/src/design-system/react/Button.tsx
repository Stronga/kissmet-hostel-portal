import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  /** Square control. Pass an accessible name with aria-label. */
  icon?: boolean;
  children?: ReactNode;
}

function classes(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  loading = false,
  icon = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const busy = Boolean(loading);
  return (
    <button
      {...props}
      type={type}
      className={classes("km-btn", `km-btn--${variant}`, icon && "km-btn--icon", className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="km-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
