import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldChrome {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
}

function useFieldIds(label: string, id: string | undefined, hint?: string, error?: string) {
  const generated = useId();
  const inputId = id ?? `${generated}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { inputId, hintId, errorId, describedBy };
}

function FieldFrame({
  label,
  hint,
  error,
  inputId,
  hintId,
  errorId,
  children
}: FieldChrome & { inputId: string; hintId?: string; errorId?: string; children: ReactNode }) {
  return (
    <div className={error ? "km-field km-field--invalid" : "km-field"}>
      <label className="km-field__label" htmlFor={inputId}>{label}</label>
      {children}
      {hint ? <p id={hintId} className="km-field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="km-field__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function TextField({ label, hint, error, id, ...props }: FieldChrome & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds(label, id, hint, error);
  return (
    <FieldFrame label={label} hint={hint} error={error} inputId={ids.inputId} hintId={ids.hintId} errorId={ids.errorId}>
      <input
        {...props}
        id={ids.inputId}
        className={props.className ? `km-field__control ${props.className}` : "km-field__control"}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
      />
    </FieldFrame>
  );
}

export function TextArea({ label, hint, error, id, ...props }: FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ids = useFieldIds(label, id, hint, error);
  return (
    <FieldFrame label={label} hint={hint} error={error} inputId={ids.inputId} hintId={ids.hintId} errorId={ids.errorId}>
      <textarea
        {...props}
        id={ids.inputId}
        className={props.className ? `km-field__control ${props.className}` : "km-field__control"}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
      />
    </FieldFrame>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  options,
  placeholder = "Select",
  ...props
}: FieldChrome & SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  const ids = useFieldIds(label, id, hint, error);
  return (
    <FieldFrame label={label} hint={hint} error={error} inputId={ids.inputId} hintId={ids.hintId} errorId={ids.errorId}>
      <select
        {...props}
        id={ids.inputId}
        className={props.className ? `km-field__control ${props.className}` : "km-field__control"}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </FieldFrame>
  );
}
