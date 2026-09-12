import { ArrowRight, BedDouble, CalendarCheck, CreditCard, FileText, HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";
import hostelIllustration from "../../assets/hostel-illustration.png";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useResidentDashboard } from "../../hooks/useResidentDashboard";
import type { DashboardData } from "../../types/resident";
import { latestAnnouncement, latestMessage, messagePreview, unreadMessageCount } from "../../utils/communications";
import { formatDateTime, formatMoneyMinor, statusLabel } from "../../utils/format";
import { buildJourney, latestApplicationSummary, latestBookingSummary, nextAction, type JourneyStage } from "../../utils/journey";

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 break-anywhere text-sm font-semibold text-text-primary">{value || "Not available"}</p>
    </div>
  );
}

function statusTone(status?: string | null) {
  if (["approved", "complete", "confirmed", "verified", "assigned", "resident"].includes(String(status))) return "bg-emerald-50 text-success";
  if (["pending", "submitted", "under_review", "current", "unread"].includes(String(status))) return "bg-blue-50 text-blue-700";
  if (["attention", "rejected", "payment_attention"].includes(String(status))) return "bg-red-50 text-danger";
  return "bg-muted text-text-secondary";
}

function MiniBadge({ status, label }: { status?: string | null; label?: string }) {
  return (
    <span className={`inline-flex w-fit rounded-full px-3 py-1 text-[11px] font-semibold ${statusTone(status)}`} aria-label={`Status: ${label ?? statusLabel(status)}`}>
      {label ?? statusLabel(status)}
    </span>
  );
}

function HomeStatusBar({ data }: { data: DashboardData }) {
  const application = latestApplicationSummary(data);
  const booking = latestBookingSummary(data);
  const payment = data.paymentSummary;
  const allocation = data.allocation;
  const bookingAmount = booking ? formatMoneyMinor(booking.total_amount_minor, booking.currency) : null;
  const allocationRoom = allocation
    ? allocation.room_name
      ? `${allocation.room_code} - ${allocation.room_name}`
      : allocation.room_code
    : "Pending";
  const allocationBed = allocation ? allocation.label ?? allocation.bed_code : null;
  const items = [
    {
      key: "application",
      label: "Application",
      value: application ? statusLabel(application.status) : "Not started",
      detail: application?.status === "approved" ? "You can proceed to booking" : application ? application.application_number : "Start when ready",
      status: application?.status === "approved" ? "complete" : application?.status,
      badge: application?.status === "approved" ? "Complete" : application ? statusLabel(application.status) : "Pending",
      icon: FileText,
      color: "text-success",
      iconBg: "bg-emerald-100"
    },
    {
      key: "booking",
      label: "Booking",
      value: booking ? statusLabel(booking.status) : "No booking",
      detail: booking ? `Booking ${booking.booking_number}` : "Created after approval",
      status: booking?.status,
      badge: booking ? statusLabel(booking.status) : "Pending",
      icon: CalendarCheck,
      color: "text-violet-600",
      iconBg: "bg-violet-100"
    },
    {
      key: "payment",
      label: "Payment",
      value: bookingAmount ?? (payment ? formatMoneyMinor(payment.verifiedTotalMinor, payment.currency) : "Unavailable"),
      detail: payment ? `${formatMoneyMinor(payment.outstandingMinor, payment.currency)} outstanding` : "Verified totals appear here",
      secondary: payment ? formatMoneyMinor(payment.verifiedTotalMinor, payment.currency) : undefined,
      tertiary: payment ? formatMoneyMinor(payment.outstandingMinor, payment.currency) : undefined,
      status: payment?.confirmationRequirementMet ? "verified" : payment ? "pending" : "pending",
      badge: payment?.confirmationRequirementMet ? "Verified" : payment ? "Outstanding" : "Pending",
      icon: CreditCard,
      color: "text-blue-600",
      iconBg: "bg-blue-100"
    },
    {
      key: "room",
      label: "My Room",
      value: allocationRoom,
      detail: allocation ? "Current active allocation" : "Room assignment pending",
      secondary: allocationBed ?? undefined,
      status: allocation ? "assigned" : "pending",
      badge: allocation ? "Assigned" : "Pending",
      icon: BedDouble,
      color: "text-amber-600",
      iconBg: "bg-amber-100"
    }
  ];

  return (
    <Card className="relative overflow-hidden border-[#d6eae5] bg-[#f4fbf9] p-0 shadow-[0_10px_30px_rgba(31,46,64,0.08)]">
      <div className="grid gap-0 lg:grid-cols-[1fr_250px] xl:grid-cols-[1fr_320px]">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <div key={item.key} className={`min-w-0 p-5 ${index > 0 ? "border-t border-[#dce8e4] sm:border-l sm:border-t-0" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <p className={`text-xs font-semibold ${item.color}`}>{item.label}</p>
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${item.iconBg}`}>
                  <item.icon size={17} className={item.color} aria-hidden="true" />
                </span>
              </div>
              <p className="mt-3 break-anywhere text-lg font-semibold text-text-primary">{item.value}</p>
              <p className="mt-1 break-anywhere text-xs text-text-secondary">{item.detail}</p>
              {item.secondary ? <p className="mt-1 break-anywhere text-xs font-semibold text-text-secondary">{item.secondary}</p> : null}
              {item.tertiary ? <p className="sr-only">{item.tertiary}</p> : null}
              <div className="mt-3">
                <MiniBadge status={item.status} label={item.badge} />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden items-end justify-end pr-3 pt-2 lg:flex" aria-hidden="true">
          <img src={hostelIllustration} alt="" className="h-32 w-auto max-w-full object-contain xl:h-40" />
        </div>
      </div>
    </Card>
  );
}

function stageDotClass(status: JourneyStage["status"]) {
  if (status === "complete" || status === "current") return "bg-primary text-white";
  if (status === "attention") return "bg-danger text-white";
  return "bg-muted text-text-secondary";
}

function progressPercent(stages: JourneyStage[]) {
  if (stages.length <= 1) return 0;
  const activeIndex = stages.findIndex((stage) => stage.status !== "complete");
  const completed = activeIndex === -1 ? stages.length - 1 : Math.max(activeIndex - 1, 0);
  return Math.round((completed / (stages.length - 1)) * 100);
}

function AccommodationJourney({ stages }: { stages: JourneyStage[] }) {
  return (
    <Card className="shadow-[0_10px_30px_rgba(31,46,64,0.07)]">
      <h2 className="text-lg font-semibold text-text-primary">Your Accommodation Journey</h2>
      <p className="mt-1 text-sm text-text-secondary">Each stage unlocks the next step in your hostel application.</p>
      <div className="relative mt-8">
        <div className="absolute left-4 right-4 top-4 hidden h-1 rounded-full bg-[#e8f7fa] md:block" aria-hidden="true" />
        <div className="absolute left-4 top-4 hidden h-1 rounded-full bg-primary md:block" style={{ width: `calc((100% - 2rem) * ${progressPercent(stages) / 100})` }} aria-hidden="true" />
        <ol className="relative grid gap-4 md:grid-cols-6" aria-label="Accommodation journey">
          {stages.map((stage, index) => (
            <li key={stage.key} className="rounded-token border border-border bg-white p-3 text-center md:border-0 md:bg-transparent md:p-0">
              <span className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${stageDotClass(stage.status)}`}>{index + 1}</span>
              <p className="mt-3 text-xs font-semibold text-text-primary">{stage.label.replace(" Assignment", "")}</p>
              <p className={`mt-1 text-[11px] ${stage.status === "attention" ? "text-danger" : stage.status === "current" ? "text-warning" : "text-text-secondary"}`}>{stage.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function NextActionCard({ action }: { action: ReturnType<typeof nextAction> }) {
  return (
    <Card className="shadow-[0_10px_30px_rgba(31,46,64,0.07)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next action</p>
          <h2 className="mt-3 break-anywhere text-xl font-semibold text-text-primary">{action.label}</h2>
          <p className="mt-2 text-sm text-text-secondary">{action.description}</p>
        </div>
        <Link to={action.href} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Continue
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <Link to={action.href} className="mt-5 inline-flex text-sm font-semibold text-primary">
        View details
      </Link>
    </Card>
  );
}

interface ActivityItem {
  key: string;
  title: string;
  detail: string;
  date?: string | null;
  color: string;
  icon: typeof FileText;
}

function recentActivity(data: DashboardData): ActivityItem[] {
  const application = latestApplicationSummary(data);
  const booking = latestBookingSummary(data);
  const allocation = data.allocation;
  return [
    application ? {
      key: "application",
      title: `Application ${statusLabel(application.status).toLowerCase()}`,
      detail: application.application_number,
      date: application.reviewed_at ?? application.submitted_at ?? application.created_at,
      color: "bg-emerald-100 text-success",
      icon: FileText
    } : null,
    booking ? {
      key: "booking",
      title: `Booking ${statusLabel(booking.status).toLowerCase()}`,
      detail: booking.booking_number,
      date: booking.booked_at ?? booking.created_at,
      color: "bg-blue-100 text-blue-700",
      icon: CalendarCheck
    } : null,
    allocation ? {
      key: "allocation",
      title: "Room assigned",
      detail: `${allocation.room_code} · ${allocation.label ?? allocation.bed_code}`,
      date: allocation.starts_on ?? allocation.assigned_at,
      color: "bg-amber-100 text-amber-700",
      icon: BedDouble
    } : null
  ].filter(Boolean) as ActivityItem[];
}

function RecentActivity({ data }: { data: DashboardData }) {
  const activity = recentActivity(data);
  return (
    <Card className="shadow-[0_10px_30px_rgba(31,46,64,0.07)]">
      <h2 className="text-lg font-semibold text-text-primary">Recent activity</h2>
      <p className="mt-1 text-sm text-text-secondary">Your latest accommodation activity</p>
      {activity.length ? (
        <div className="mt-5 space-y-3">
          {activity.map((item) => (
            <div key={item.key} className="grid gap-3 rounded-token bg-[#fbfcfd] p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.color}`}>
                <item.icon size={17} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="break-anywhere text-sm font-semibold text-text-primary">{item.title}</p>
                <p className="break-anywhere text-xs text-text-secondary">{item.detail}</p>
              </div>
              <p className="text-xs font-medium text-text-secondary">{formatDateTime(item.date)}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No recent activity" message="Accommodation activity will appear as your application progresses." />
      )}
    </Card>
  );
}

function ResidentUpdates({ data }: { data: DashboardData }) {
  const announcement = latestAnnouncement(data.announcements);
  const message = latestMessage(data.messages);
  const unread = unreadMessageCount(data.messages);
  const updates = [
    message ? { key: "message", title: message.subject, description: messagePreview(message, 90) || "No message body provided.", date: message.sent_at ?? message.delivered_at, unread: message.status === "unread", href: "/messages" } : null,
    announcement ? { key: "announcement", title: announcement.title, description: messagePreview({ body: announcement.body ?? "" }, 90) || "No announcement details provided.", date: announcement.published_at ?? announcement.starts_at, unread: false, href: "/announcements" } : null
  ].filter(Boolean) as Array<{ key: string; title: string; description: string; date?: string | null; unread: boolean; href: string }>;

  return (
    <Card className="shadow-[0_10px_30px_rgba(31,46,64,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Updates</h2>
          <p className="mt-1 text-sm text-text-secondary">Latest hostel notices and messages</p>
        </div>
        {unread ? <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-primary">{unread} unread</span> : null}
      </div>
      {updates.length ? (
        <div className="mt-5 space-y-3">
          {updates.map((item) => (
            <Link key={item.key} to={item.href} className="grid gap-3 rounded-token bg-[#fbfcfd] p-3 hover:bg-muted sm:grid-cols-[auto_1fr_auto] sm:items-start">
              <span className={`mt-1 h-2 w-2 rounded-full ${item.unread ? "bg-primary" : "bg-accent"}`} aria-label={item.unread ? "Unread" : "Read"} />
              <span className="min-w-0">
                <span className="block break-anywhere text-sm font-semibold text-text-primary">{item.title}</span>
                <span className="mt-1 block text-xs text-text-secondary">{item.description}</span>
              </span>
              <span className="text-xs text-text-secondary">{formatDateTime(item.date)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No updates right now." message="Announcements and private messages will appear here." />
      )}
      <div className="mt-5 flex flex-wrap gap-4">
        <Link to="/messages" className="text-sm font-semibold text-primary">View messages</Link>
        <Link to="/announcements" className="text-sm font-semibold text-primary">View announcements</Link>
      </div>
    </Card>
  );
}

function NeedHelpCard() {
  return (
    <Link to="/maintenance" className="group flex min-h-[122px] items-center justify-between gap-5 rounded-[16px] bg-primary p-6 text-white shadow-[0_10px_30px_rgba(5,98,104,0.22)]">
      <span className="flex items-center gap-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-primary">
          <HelpCircle size={26} aria-hidden="true" />
        </span>
        <span>
          <span className="block text-lg font-semibold">Need Help?</span>
          <span className="mt-1 block text-sm text-[#d7ece9]">Report an issue or contact support.</span>
        </span>
      </span>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-primary transition group-hover:translate-x-1" aria-hidden="true">
        <ArrowRight size={22} />
      </span>
    </Link>
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
  const action = nextAction(data);
  const journey = buildJourney(data);

  return (
    <>
      <PageHeader title="Home" description="Track your accommodation journey and what needs your attention." />
      {data.partialErrors.length ? (
        <div className="mb-5">
          <ErrorState title="Some dashboard sections could not load" message={data.partialErrors.join(" ")} onRetry={() => void retry()} retryLabel="Retry failed sections" />
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-text-secondary">Welcome, {fullName || "Resident"}</p>
          <p className="text-xs text-text-secondary">Your dashboard summarizes your current accommodation status.</p>
          <p className="text-xs text-text-secondary">{data.profile.institution_name ?? "Institution not available"} · {data.profile.student_id ?? "Student ID unavailable"}</p>
        </div>
        <StatusBadge status={data.profile.status} />
      </div>

      <HomeStatusBar data={data} />

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.75fr]">
        <div className="space-y-5">
          <AccommodationJourney stages={journey} />
          <RecentActivity data={data} />
        </div>
        <div className="space-y-5">
          <NextActionCard action={action} />
          <ResidentUpdates data={data} />
          <NeedHelpCard />
        </div>
      </div>

      <Card className="mt-5 lg:hidden">
        <h2 className="text-base font-semibold text-text-primary">Resident identity</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="Kissmet resident code" value={data.profile.resident_code} />
          <Detail label="Student ID" value={data.profile.student_id} />
          <Detail label="Phone" value={data.profile.phone} />
          <Detail label="Email" value={data.profile.email} />
        </div>
      </Card>
    </>
  );
}
