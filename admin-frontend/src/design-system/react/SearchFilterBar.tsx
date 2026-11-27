import { useId, type FormEvent, type ReactNode } from "react";

export function SearchFilterBar({
  label,
  value,
  onChange,
  onSubmit,
  placeholder = "Search",
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  const queryId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit?.();
  }

  return (
    <form className="km-search" role="search" onSubmit={submit}>
      <div className="km-field km-search__query">
        <label className="km-field__label" htmlFor={queryId}>{label}</label>
        <input
          id={queryId}
          className="km-field__control"
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {children}
      <button className="km-btn km-btn--secondary" type="submit">Search</button>
    </form>
  );
}
