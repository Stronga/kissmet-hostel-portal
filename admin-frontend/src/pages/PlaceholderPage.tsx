import { EmptyState } from "../components/common/EmptyState";
import { PageHeader } from "../components/layout/PageHeader";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} eyebrow="Admin" />
      <EmptyState title={title} message="Coming in the next frontend phase." />
    </div>
  );
}
