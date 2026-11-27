import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getCommandCentre, getOccupancyRooms, type CommandCentre, type OccupancyRoomRow } from "../../api/dashboard";
import { ActivityCentre } from "../../components/dashboard/ActivityCentre";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { ConnectorStatusCard } from "../../components/internet/ConnectorStatusCard";
import { PageHeader } from "../../components/layout/PageHeader";
import { DataTable } from "../../design-system/react/DataTable";
import { SummaryCard } from "../../design-system/react/SummaryCard";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";

function scopeQuery(sessionId: string, periodId: string) {
  const params = new URLSearchParams();
  if (sessionId) params.set("academicSessionId", sessionId);
  if (periodId) params.set("leasePeriodId", periodId);
  const text = params.toString();
  return text ? `&${text}` : "";
}

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("academicSessionId") ?? "";
  const periodId = searchParams.get("leasePeriodId") ?? "";
  const activityOpen = searchParams.get("activity") !== "closed";
  const [data, setData] = useState<CommandCentre | null>(null);
  const [rooms, setRooms] = useState<OccupancyRoomRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const scope = { academicSessionId: sessionId || undefined, leasePeriodId: periodId || undefined };
    Promise.all([
      getCommandCentre(scope),
      getOccupancyRooms(scope).catch(() => null)
    ]).then(([centre, occupancy]) => {
      if (!alive) return;
      setData(centre);
      setRooms(occupancy?.rooms ?? null);
    }).catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : "Unable to load dashboard.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [periodId, sessionId]);

  function setScope(next: { academicSessionId?: string; leasePeriodId?: string }) {
    const params = new URLSearchParams(searchParams);
    params.delete("academicSessionId");
    params.delete("leasePeriodId");
    if (next.academicSessionId) params.set("academicSessionId", next.academicSessionId);
    if (next.leasePeriodId) params.set("leasePeriodId", next.leasePeriodId);
    setSearchParams(params);
  }

  function setActivity(open: boolean) {
    const params = new URLSearchParams(searchParams);
    if (open) params.delete("activity");
    else params.set("activity", "closed");
    setSearchParams(params, { replace: true });
  }

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (error || !data?.scope || !data.actionable) return <ErrorState message={error ?? "Dashboard data is unavailable."} />;

  const scope = scopeQuery(sessionId, periodId);
  const actionable = data.actionable;
  const cards: Array<{ key: string; label: string; value: number; href: string; helper: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" }> = [];
  if (actionable.applicationsAwaitingReview != null) cards.push({ key: "review", label: "Applications awaiting review", value: actionable.applicationsAwaitingReview, href: `/applications?queue=awaiting_review${scope}`, helper: "Submitted and under review. Drafts are excluded.", tone: "warning" });
  if (actionable.draftApplications != null) cards.push({ key: "drafts", label: "Draft applications", value: actionable.draftApplications, href: `/applications?queue=drafts${scope}`, helper: "Started, not submitted. Shown separately from review.", tone: "info" });
  if (actionable.applicationsRequiringAttention != null) cards.push({ key: "attention", label: "Applications requiring attention", value: actionable.applicationsRequiringAttention, href: `/applications?queue=attention${scope}`, helper: "Under review and still awaiting a decision.", tone: "warning" });
  if (actionable.agreementsAwaitingPreparation != null) cards.push({ key: "agreements", label: "Agreements awaiting preparation", value: actionable.agreementsAwaitingPreparation, href: `/applications?queue=agreements${scope}`, helper: "Approved, with no booking yet.", tone: "info" });
  if (actionable.paymentsAwaitingVerification != null) cards.push({ key: "payments", label: "Payments awaiting verification", value: actionable.paymentsAwaitingVerification, href: `/payments?queue=awaiting_verification${scope}`, helper: "Pending and submitted payments.", tone: "warning" });
  if (actionable.refundsAwaitingApproval != null) cards.push({ key: "refunds", label: "Refunds awaiting approval", value: actionable.refundsAwaitingApproval, href: `/refunds?status=requested${scope}`, helper: "Requested refunds. Approval stays with a different staff member.", tone: "danger" });
  if (actionable.bookingsAwaitingAllocation != null) cards.push({ key: "allocation", label: "Bookings awaiting allocation", value: actionable.bookingsAwaitingAllocation, href: `/bookings?queue=awaiting_allocation${scope}`, helper: "Confirmed bookings with no active bed.", tone: "warning" });
  if (actionable.urgentMaintenance != null) cards.push({ key: "maintenance", label: "Urgent maintenance", value: actionable.urgentMaintenance, href: `/maintenance?priority=urgent&status=open`, helper: "Open, assigned, or in progress.", tone: actionable.urgentMaintenance > 0 ? "danger" : "neutral" });
  if (actionable.internetProvisioningFailures != null) cards.push({ key: "internet", label: "Internet provisioning failures", value: actionable.internetProvisioningFailures, href: `/internet-access?sync_status=failed`, helper: "Accounts whose sync status is failed.", tone: "danger" });
  if (actionable.operationalIssues != null) cards.push({ key: "issues", label: "Other operational issues", value: actionable.operationalIssues, href: `/bookings?queue=payment_attention${scope}`, helper: "Bookings flagged for payment attention.", tone: "warning" });

  return (
    <div className={activityOpen ? "km-command km-command--open" : "km-command"}>
      <div className="km-command__head space-y-4">
        <PageHeader title="Dashboard" eyebrow="Command centre" description={`Reporting scope: ${data.scope.label}`} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block text-sm font-medium text-text-primary">
            Academic session or accommodation period
            <select
              aria-label="Reporting scope"
              className="mt-1 block rounded-md border border-border bg-white px-3 py-2 text-sm"
              value={sessionId ? `session:${sessionId}` : periodId ? `period:${periodId}` : "all"}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "all") setScope({});
                else if (value.startsWith("session:")) setScope({ academicSessionId: value.slice("session:".length) });
                else setScope({ leasePeriodId: value.slice("period:".length) });
              }}
            >
              <option value="all">All periods</option>
              <optgroup label="Academic sessions">
                {(data.periods?.academicSessions ?? []).map((session) => <option key={session.id} value={`session:${session.id}`}>{session.name}</option>)}
              </optgroup>
              <optgroup label="Accommodation periods">
                {(data.periods?.leasePeriods ?? []).map((period) => <option key={period.id} value={`period:${period.id}`}>{period.name}</option>)}
              </optgroup>
            </select>
          </label>
          <p className="text-sm text-text-secondary" data-testid="scope-label">{data.scope.label}</p>
          {!activityOpen ? <button type="button" className="km-btn km-btn--secondary" onClick={() => setActivity(true)} aria-expanded="false">Show activity</button> : null}
        </div>
      </div>
      <div className="km-command__main space-y-6">
        <ConnectorStatusCard />

        <section aria-label="Actionable work">
          <h2 className="mb-3 text-base font-semibold text-text-primary">Actionable work</h2>
          {cards.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => <SummaryCard key={card.key} label={card.label} value={card.value} helper={card.helper} href={card.href} tone={card.tone} />)}
            </div>
          ) : <p className="text-sm text-text-secondary">No actionable queues are visible for this role.</p>}
        </section>

        {data.summary.totalResidents != null || data.summary.occupiedBeds != null ? (
          <section aria-label="Informational summary">
            <h2 className="mb-3 text-base font-semibold text-text-primary">Summary</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.summary.totalResidents != null ? <SummaryCard label="Total residents" value={data.summary.totalResidents} helper="Roster count. Not limited by the selected period." /> : null}
              {data.summary.activeResidents != null ? <SummaryCard label="Active residents" value={data.summary.activeResidents} helper="Residents whose status is Resident. Occupancy is counted separately from active allocations." tone="success" /> : null}
              {data.summary.applicants != null ? <SummaryCard label="Applicants" value={data.summary.applicants} helper="Residents whose status is Applicant." /> : null}
              {data.summary.occupiedBeds != null ? <SummaryCard label="Occupied beds" value={data.summary.occupiedBeds} helper="Active allocations in the selected scope." /> : null}
              {data.summary.availableBeds != null ? <SummaryCard label="Available beds" value={data.summary.availableBeds} helper="Usable beds minus occupied beds in this scope." tone="success" /> : null}
              {data.summary.occupancyPercentage != null ? <SummaryCard label="Occupancy" value={`${data.summary.occupancyPercentage}%`} helper="Occupied beds divided by usable beds." /> : null}
            </div>
          </section>
        ) : null}

        {data.finance ? (
          <section aria-label="Financial performance">
            <h2 className="mb-3 text-base font-semibold text-text-primary">Financial performance</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Expected booking revenue" value={formatCurrencyMinor(data.finance.expectedBookingRevenue)} helper="Pending, confirmed, and completed agreements in this scope." />
              <SummaryCard label="Verified payments" value={formatCurrencyMinor(data.finance.verifiedPayments)} helper="Net of paid refunds." tone="success" />
              <SummaryCard label="Outstanding balance" value={formatCurrencyMinor(data.finance.outstandingBookingBalances)} helper="Expected revenue minus net verified payments." tone="warning" />
              <SummaryCard label="Awaiting verification" value={formatCurrencyMinor(data.finance.paymentsAwaitingVerificationTotal)} helper={`${data.finance.paymentsAwaitingVerificationCount} payments.`} />
            </div>
          </section>
        ) : null}

        {rooms ? (
          <section aria-label="Room and bed occupancy">
            <h2 className="mb-3 text-base font-semibold text-text-primary">Room and bed occupancy</h2>
            <DataTable
              caption="Rooms with beds and current occupants"
              rows={rooms}
              getRowId={(room) => String(room.id)}
              emptyTitle="No rooms"
              emptyMessage="Rooms will appear after they are added in setup."
              columns={[
                { key: "room", header: "Room", render: (room) => room.roomCode },
                { key: "capacity", header: "Capacity", render: (room) => room.capacity },
                { key: "occupied", header: "Occupied", render: (room) => `${room.occupiedBeds} / ${room.beds.length}` },
                { key: "policy", header: "Gender policy", render: (room) => formatStatus(room.genderPolicy) },
                { key: "status", header: "Status", render: (room) => formatStatus(room.status) }
              ]}
              renderExpanded={(room) => room.beds.length ? (
                <ul className="space-y-1 text-sm">
                  {room.beds.map((bed) => (
                    <li key={bed.id}>{bed.label} ({bed.bedCode}) — {bed.occupant ? `${bed.occupant.name} · ${bed.occupant.residentCode}` : formatStatus(bed.status)}</li>
                  ))}
                </ul>
              ) : <p className="text-sm text-text-secondary">No beds recorded for this room.</p>}
            />
          </section>
        ) : null}
      </div>
      {activityOpen ? (
        <aside className="km-command__aside">
          <ActivityCentre onCollapse={() => setActivity(false)} />
        </aside>
      ) : null}
    </div>
  );
}
