import { Card } from "../../components/common/Card";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";

const journeyCards = [
  { title: "Application", text: "Your application progress will appear here." },
  { title: "Booking", text: "Your booking summary will appear here." },
  { title: "Payment", text: "Your payment summary will appear here." },
  { title: "My Room", text: "Your room and bed details will appear here." }
];

export function HomePage() {
  const { user } = useAuth();
  usePageTitle("Home");

  return (
    <>
      <PageHeader
        title={`Welcome${user?.displayName ? `, ${user.displayName}` : ""}`}
        description="Your hostel journey summary will appear here as each resident portal workflow is connected."
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-secondary">Resident portal identity</p>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{user?.displayName ?? "Resident"}</h2>
              <p className="mt-1 text-sm text-text-secondary">Your verified resident profile will be shown here in a later phase.</p>
            </div>
            <StatusBadge status="resident_portal" />
          </div>
        </Card>
        <Card>
          <p className="text-sm font-semibold text-text-secondary">Next action</p>
          <p className="mt-3 text-lg font-semibold text-text-primary">No current action is available yet.</p>
          <p className="mt-2 text-sm text-text-secondary">The next required step will appear after the relevant resident workflow is connected.</p>
        </Card>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {journeyCards.map((card) => (
          <Card key={card.title}>
            <h2 className="text-base font-semibold text-text-primary">{card.title}</h2>
            <p className="mt-2 text-sm text-text-secondary">{card.text}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
