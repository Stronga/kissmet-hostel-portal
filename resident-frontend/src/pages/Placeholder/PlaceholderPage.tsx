import { EmptyState } from "../../components/common/EmptyState";
import { PageHeader } from "../../components/layout/PageHeader";
import { usePageTitle } from "../../hooks/usePageTitle";

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  usePageTitle(title);
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState title="Coming in a later resident portal phase" message="This area is reserved for the approved backend workflow and will use real API data when implemented." />
    </>
  );
}
