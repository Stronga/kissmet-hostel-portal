import { Link } from "react-router-dom";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useResidentDashboard } from "../../hooks/useResidentDashboard";
import { formatDateTime, formatMoneyMinor, statusLabel } from "../../utils/format";
import { latestAnnouncement, latestMessage, messagePreview, unreadMessageCount } from "../../utils/communications";
import { buildJourney, latestApplicationSummary, latestBookingSummary, nextAction } from "../../utils/journey";

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 break-anywhere text-sm font-semibold text-text-primary">{value || "Not available"}</p>
    </div>
  );
}

export function HomePage() {
  const { data, isLoading, error, retry } = useResidentDashboard();
  usePageTitle("Home");

  if (isLoading) return <LoadingState label="Loading your dashboard" />;
  if (error || !data) {
    return <ErrorState title="Dashboard unavailable" message={error ?? "Unable to load your dashboard."} onRetry={() => void retry()} />;
  }

  const fullName = [data.profile.first_name, data.profile.middle_name, data.profile.last_name].filter(Boolean).join(" ");
  const journey = buildJourney(data);
  const action = nextAction(data);
  const application = latestApplicationSummary(data);
  const booking = latestBookingSummary(data);
  const announcement = latestAnnouncement(data.announcements);
  const message = latestMessage(data.messages);
  const unread = unreadMessageCount(data.messages);

  return (
    <>
      <PageHeader
        title={`Welcome, ${fullName || "Resident"}`}
        description="Your dashboard summarizes the resident-owned information currently available from Kissmet."
      />
      {data.partialErrors.length ? (
        <div className="mb-5">
          <ErrorState title="Some dashboard sections could not load" message={data.partialErrors.join(" ")} onRetry={() => void retry()} retryLabel="Retry failed sections" />
        </div>
      ) : null}

      <Card className="mb-5 border-primary/30 bg-primary/5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next action</p>
        <h2 className="mt-2 text-2xl font-semibold text-text-primary">{action.label}</h2>
        <p className="mt-2 text-sm text-text-secondary">{action.description}</p>
        <Link
          to={action.href}
          className="mt-4 inline-flex min-h-11 items-center rounded-token bg-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Continue
        </Link>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-secondary">Resident identity</p>
            <h2 className="mt-1 break-anywhere text-xl font-semibold text-text-primary">{fullName || "Resident"}</h2>
            <p className="mt-1 text-sm text-text-secondary">{data.profile.institution_name ?? "Institution not available"}</p>
          </div>
          <StatusBadge status={data.profile.status} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Kissmet resident code" value={data.profile.resident_code} />
          <Detail label="Student ID" value={data.profile.student_id} />
          <Detail label="Phone" value={data.profile.phone} />
          <Detail label="Email" value={data.profile.email} />
        </div>
      </Card>

      <Card className="mt-5">
        <h2 className="text-lg font-semibold text-text-primary">Accommodation Journey</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Accommodation journey">
          {journey.map((stage, index) => (
            <li key={stage.key} className="rounded-token border border-border bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-primary" aria-hidden="true">{index + 1}</span>
                <StatusBadge status={stage.status} />
              </div>
              <p className="mt-3 text-sm font-semibold text-text-primary">{stage.label}</p>
              <p className="mt-1 text-xs text-text-secondary">{stage.detail}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <h2 className="text-base font-semibold text-text-primary">Application</h2>
          {application ? (
            <div className="mt-3 space-y-3">
              <Detail label="Application number" value={application.application_number} />
              <Detail label="Status" value={statusLabel(application.status)} />
              <Detail label="Submitted" value={formatDateTime(application.submitted_at)} />
              {application.status === "approved" ? (
                <p className="text-xs text-text-secondary">Approval means you are eligible for booking — not that a room or payment is complete.</p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="No application" message="No resident application is available yet." actionHref="/application" actionLabel="Go to application" />
          )}
        </Card>
        <Card>
          <h2 className="text-base font-semibold text-text-primary">Booking</h2>
          {booking ? (
            <div className="mt-3 space-y-3">
              <Detail label="Booking number" value={booking.booking_number} />
              <Detail label="Status" value={statusLabel(booking.status)} />
              <Detail label="Total" value={formatMoneyMinor(booking.total_amount_minor, booking.currency)} />
            </div>
          ) : (
            <EmptyState title="No booking" message="No active booking is available yet." actionHref="/booking" actionLabel="View booking" />
          )}
        </Card>
        <Card>
          <h2 className="text-base font-semibold text-text-primary">Payment</h2>
          {booking ? (
            <div className="mt-3 space-y-3">
              <Detail label="Booking total" value={formatMoneyMinor(booking.total_amount_minor, booking.currency)} />
              <Detail label="Verified payments" value={data.paymentSummary ? formatMoneyMinor(data.paymentSummary.verifiedTotalMinor, data.paymentSummary.currency) : "Unavailable"} />
              <Detail label="Outstanding" value={data.paymentSummary ? formatMoneyMinor(data.paymentSummary.outstandingMinor, data.paymentSummary.currency) : "Unavailable"} />
              <p className="text-xs text-text-secondary">Outstanding uses verified totals only. Uploading a slip is not verification.</p>
              {data.paymentSummary?.paymentAttentionRequired ? <p className="text-xs font-semibold text-danger">Payment attention required.</p> : null}
            </div>
          ) : (
            <EmptyState title="No payment summary" message="Payment details will appear after a booking exists." actionHref="/payments" actionLabel="Go to payments" />
          )}
        </Card>
        <Card>
          <h2 className="text-base font-semibold text-text-primary">Room Assignment</h2>
          {data.allocation ? (
            <div className="mt-3 space-y-3">
              <Detail label="Room" value={data.allocation.room_name ? `${data.allocation.room_code} - ${data.allocation.room_name}` : data.allocation.room_code} />
              <Detail label="Bed" value={data.allocation.label ?? data.allocation.bed_code} />
              <Detail label="Assigned" value={formatDateTime(data.allocation.starts_on)} />
            </div>
          ) : (
            <EmptyState title="Room assignment pending" message="A room is shown only when an active allocation exists." actionHref="/room" actionLabel="View My Room" />
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Updates</h2>
            <p className="mt-1 text-sm text-text-secondary">Latest resident-visible communication from Kissmet.</p>
          </div>
          {unread ? (
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-primary" aria-label={`${unread} unread messages`}>
              <span aria-hidden="true">●</span>
              {unread} unread
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-token border border-border bg-white p-4">
            <h3 className="text-base font-semibold text-text-primary">Latest announcement</h3>
            {announcement ? (
              <div className="mt-3 space-y-2">
                <p className="break-anywhere text-sm font-semibold text-text-primary">{announcement.title}</p>
                <p className="text-sm text-text-secondary">{messagePreview({ body: announcement.body ?? "" }, 100) || "No announcement details provided."}</p>
                <p className="text-xs font-semibold text-text-secondary">{formatDateTime(announcement.published_at ?? announcement.starts_at)}</p>
                <Link to="/announcements" className="inline-flex min-h-10 items-center rounded-token bg-muted px-3 py-2 text-sm font-semibold text-primary">View announcements</Link>
              </div>
            ) : (
              <EmptyState title="No announcements right now." message="Published resident notices will appear here." actionHref="/announcements" actionLabel="Open announcements" />
            )}
          </section>
          <section className="rounded-token border border-border bg-white p-4">
            <h3 className="text-base font-semibold text-text-primary">Latest message</h3>
            {message ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-anywhere text-sm font-semibold text-text-primary">{message.subject}</p>
                  {message.status === "unread" ? (
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-primary" aria-label="Unread">
                      Unread
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-text-secondary">{messagePreview(message, 100) || "No message body provided."}</p>
                <p className="text-xs font-semibold text-text-secondary">{formatDateTime(message.sent_at ?? message.delivered_at)}</p>
                <Link to="/messages" className="inline-flex min-h-10 items-center rounded-token bg-muted px-3 py-2 text-sm font-semibold text-primary">View messages</Link>
              </div>
            ) : (
              <EmptyState title="You don't have any messages yet." message="Private Kissmet messages delivered to you will appear here." actionHref="/messages" actionLabel="Open messages" />
            )}
          </section>
        </div>
      </Card>
    </>
  );
}
