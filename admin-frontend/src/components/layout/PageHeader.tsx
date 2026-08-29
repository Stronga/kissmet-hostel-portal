export function PageHeader({ title, description, eyebrow }: { title: string; description?: string; eyebrow?: string }) {
  return (
    <div className="mb-5">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{eyebrow}</p> : null}
      <h1 className="mt-1 text-2xl font-semibold text-text-primary">{title}</h1>
      {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
    </div>
  );
}
