interface PageHeaderProps {
  title: string;
  description?: string;
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
      {description ? <p className="mt-2 max-w-2xl text-sm text-text-secondary">{description}</p> : null}
    </div>
  );
}
