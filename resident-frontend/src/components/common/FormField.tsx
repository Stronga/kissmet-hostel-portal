import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export function FormField({ label, hint, error, id, className = "", ...props }: FormFieldProps) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="block text-sm font-semibold text-text-primary" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={`mt-2 min-h-11 w-full rounded-token border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint ? <p id={hintId} className="mt-1 text-xs text-text-secondary">{hint}</p> : null}
      {error ? <p id={errorId} className="mt-1 text-xs text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

export function SelectField({ label, hint, error, id, className = "", options, ...props }: SelectFieldProps) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="block text-sm font-semibold text-text-primary" htmlFor={inputId}>{label}</label>
      <select
        id={inputId}
        className={`mt-2 min-h-11 w-full rounded-token border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      >
        <option value="">Select an institution</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {hint ? <p id={hintId} className="mt-1 text-xs text-text-secondary">{hint}</p> : null}
      {error ? <p id={errorId} className="mt-1 text-xs text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
