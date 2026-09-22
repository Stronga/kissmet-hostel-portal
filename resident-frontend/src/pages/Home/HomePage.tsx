import {
  ArrowRight,
  BedDouble,
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  FileText,
  Headset,
  IdCard,
  Layers,
  Megaphone,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import hostelDashboard from "../../assets/hostel-dashboard.png";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { ResidentShellOutletContext } from "../../components/layout/ResidentShell";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useResidentDashboard } from "../../hooks/useResidentDashboard";
import type { DashboardData } from "../../types/resident";
import { latestAnnouncement, latestMessage, messagePreview, unreadMessageCount } from "../../utils/communications";
import { formatDateTime, formatMoneyMinor, statusLabel } from "../../utils/format";
import { buildJourney, latestApplicationSummary, latestBookingSummary, nextAction, type JourneyStage } from "../../utils/journey";
import { InternetAccessCard } from "./InternetAccessCard";

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-text-primary">{value || "Not available"}</p>
    </div>
  );
}

function statusTone(status?: string | null) {
  if (["approved", "complete", "confirmed", "verified", "assigned", "resident"].includes(String(status))) {
    return "bg-[#dcf1e9] text-[#127b55]";
  }
  if (["pending", "submitted", "under_review", "current", "unread"].includes(String(status))) {
    return "bg-[#e6f2fb] text-[#1974d2]";
  }
  if (["attention", "rejected", "payment_attention"].includes(String(status))) {
    return "bg-red-50 text-danger";
  }
  if (["booking", "confirmed_booking"].includes(String(status))) {
    return "bg-[#efe9fb] text-[#6e48b9]";
  }
  return "bg-muted text-text-secondary";
}

function MiniBadge({
  status,
  label,
  tone,
  icon: Icon
}: {
  status?: string | null;
  label?: string;
  tone?: string;
  icon?: LucideIcon;
}) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ${tone ?? statusTone(status)}`}
      aria-label={`Status: ${label ?? statusLabel(status)}`}
    >
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
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
      badgeTone: application?.status === "approved" ? "bg-[#dcf1e9] text-[#127b55]" : undefined,
      badgeIcon: application?.status === "approved" ? CheckCircle2 : undefined,
      labelClass: "text-[#127b55]",
      showDot: true,
      icon: FileText,
      iconBg: "bg-[#dcf1e9] text-[#127b55]"
    },
    {
      key: "booking",
      label: "Booking",
      value: booking ? statusLabel(booking.status) : "No booking",
      detail: booking ? `Booking ${booking.booking_number}` : "Created after approval",
      status: booking?.status,
      badge: booking ? statusLabel(booking.status) : "Pending",
      badgeTone: "bg-[#efe9fb] text-[#6e48b9]",
      labelClass: "text-text-secondary",
      showDot: false,
      icon: CalendarCheck,
      iconBg: "bg-[#efe9fb] text-[#6e48b9]"
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
      badgeTone: "bg-[#e6f2fb] text-[#1974d2]",
      labelClass: "text-[#1974d2]",
      showDot: false,
      icon: CreditCard,
      iconBg: "bg-[#e6f2fb] text-[#1974d2]"
    },
    {
      key: "room",
      label: "My Room",
      value: allocationRoom,
      detail: allocation ? "Current active allocation" : "Room assignment pending",
      secondary: allocationBed ?? undefined,
      status: allocation ? "assigned" : "pending",
      badge: allocation ? "Assigned" : "Pending",
      badgeTone: "bg-[#fdf0e6] text-[#c7691a]",
      labelClass: "text-[#c7691a]",
      showDot: false,
      icon: BedDouble,
      iconBg: "bg-[#fdf0e6] text-[#c7691a]"
    }
  ];

  return (
    <section className="relative z-10 mb-6 overflow-hidden rounded-3xl border border-[#d6eae5] bg-gradient-to-br from-[#ebf8f5] to-[#f6fcfb] p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:p-5 min-[1400px]:mb-16 min-[1400px]:mt-4 min-[1400px]:overflow-visible min-[1400px]:p-[15px]">
      <div
        className="pointer-events-none absolute -top-14 right-0 z-0 hidden h-[calc(100%+3.5rem)] w-[40%] bg-contain bg-right-bottom bg-no-repeat min-[1400px]:block"
        style={{ backgroundImage: `url(${hostelDashboard})` }}
        aria-hidden="true"
      />
      {/*
        Breakpoints:
        - default: vertical stack
        - sm–lg (tablet / small desktop without sidebar): clean 2×2 grid — never 4 squeezed columns
        - xl (1200–1399 with sidebar): keep 2×2 so summary is not squeezed beside the sidebar
        - min 1400px: horizontal 4-column row + illustration
      */}
      <div className="relative z-[1] flex items-stretch justify-between gap-6">
        <div className="grid w-full grid-cols-1 gap-0 sm:grid-cols-2 min-[1400px]:flex min-[1400px]:w-[62%] min-[1400px]:items-stretch min-[1400px]:gap-6">
          {items.map((item, index) => (
            <div key={item.key} className="contents">
              {index > 0 ? <div className="hidden w-px self-stretch bg-[#d1e6e0] min-[1400px]:my-2 min-[1400px]:block" aria-hidden="true" /> : null}
              <div
                className={`flex min-w-0 flex-1 flex-col items-start p-4 sm:p-4 min-[1400px]:p-2 ${
                  index > 0
                    ? "border-t border-[#dce8e4] sm:border-t-0 sm:border-l-0 min-[1400px]:border-0 " +
                      (index % 2 === 1 ? "sm:border-l sm:border-[#dce8e4] " : "") +
                      (index >= 2 ? "sm:border-t sm:border-[#dce8e4] " : "")
                    : ""
                }`}
              >
                <div className="mb-3 flex items-center gap-2">
                  {item.showDot ? (
                    <span className="h-2 w-2 rounded-full bg-[#127b55]" aria-hidden="true" />
                  ) : (
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${item.iconBg}`}>
                      <item.icon size={14} aria-hidden="true" />
                    </span>
                  )}
                  <p className={`text-xs font-semibold ${item.labelClass}`}>{item.label}</p>
                </div>
                {/* Avoid break-anywhere here — it letter-breaks short status words when columns squeeze. */}
                <p className="text-[20px] font-bold leading-tight text-text-primary sm:text-[22px]">{item.value}</p>
                <p className="mt-1 mb-4 text-xs leading-snug text-text-secondary">{item.detail}</p>
                {item.secondary ? <p className="mb-1 text-xs font-semibold text-text-secondary">{item.secondary}</p> : null}
                {item.tertiary ? <p className="sr-only">{item.tertiary}</p> : null}
                <MiniBadge status={item.status} label={item.badge} tone={item.badgeTone} icon={item.badgeIcon} />
              </div>
            </div>
          ))}
        </div>
        <div className="relative z-[2] hidden w-[38%] shrink-0 min-[1400px]:block" aria-hidden="true" />
      </div>
    </section>
  );
}


const journeyIcons: Record<string, LucideIcon> = {
  account: UserRound,
  documents: IdCard,
  application: Layers,
  booking: CalendarCheck,
  payment: CreditCard,
  room: BedDouble
};

function stageStatusClass(status: JourneyStage["status"]) {
  if (status === "complete") return "text-[#127b55]";
  if (status === "current") return "text-[#1974d2]";
  if (status === "attention") return "text-danger";
  return "text-text-secondary";
}

function progressPercent(stages: JourneyStage[]) {
  if (stages.length <= 1) return 0;
  const activeIndex = stages.findIndex((stage) => stage.status !== "complete");
  const completed = activeIndex === -1 ? stages.length - 1 : Math.max(activeIndex - 1, 0);
  return Math.round((completed / (stages.length - 1)) * 100);
}

function AccommodationJourney({ stages }: { stages: JourneyStage[] }) {
  const progress = progressPercent(stages);
  return (
    <Card className="!rounded-3xl border-[#eaeff2] !p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:!p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Your Accommodation Journey</h2>
          <p className="mt-1 text-[13px] text-text-secondary">Each stage unlocks the next step in your hostel application.</p>
        </div>
        <Link
          to="/application"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#f3f6f8] px-4 py-2 text-[13px] font-semibold text-text-primary hover:bg-[#e8ecef]"
        >
          View Details
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      {/* Horizontal journey only when labels fit (xl+ with sidebar room, or lg+ full-width tablet). */}
      <div className="relative hidden overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] lg:block xl:hidden min-[1400px]:block [&::-webkit-scrollbar]:hidden">
        <div className="relative min-w-[700px] px-5 py-2.5">
          <div className="absolute left-[60px] right-[60px] top-8 hidden h-0.5 rounded-full bg-[#e2e8f0] lg:block" aria-hidden="true" />
          <div
            className="absolute left-[60px] top-8 hidden h-0.5 rounded-full bg-primary lg:block"
            style={{ width: `calc((100% - 120px) * ${progress / 100})` }}
            aria-hidden="true"
          />
          <ol className="relative z-[1] grid grid-cols-6 gap-2" aria-label="Accommodation journey">
            {stages.map((stage) => {
              const Icon = journeyIcons[stage.key] ?? FileText;
              const active = stage.status === "complete" || stage.status === "current";
              return (
                <li key={stage.key} className="flex w-full flex-col items-center text-center">
                  <span
                    className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full shadow-[0_0_0_6px_white] ${
                      active ? "bg-primary text-white" : stage.status === "attention" ? "bg-danger text-white" : "bg-[#e2e8f0] text-white"
                    }`}
                  >
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <p className="mb-1 text-[13px] font-semibold text-text-primary">{stage.label.replace(" Assignment", "")}</p>
                  <p className={`text-xs font-medium ${stageStatusClass(stage.status)}`}>{stage.detail}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {/* Stacked journey below lg — same stages, no duplication of data */}
      <ol className="mt-4 space-y-3 lg:hidden xl:block min-[1400px]:hidden" aria-label="Accommodation journey mobile">
        {stages.map((stage) => {
          const Icon = journeyIcons[stage.key] ?? FileText;
          const active = stage.status === "complete" || stage.status === "current";
          return (
            <li key={`m-${stage.key}`} className="flex items-start gap-3 rounded-xl border border-border bg-white p-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  active ? "bg-primary text-white" : stage.status === "attention" ? "bg-danger text-white" : "bg-[#e2e8f0] text-white"
                }`}
              >
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{stage.label}</span>
                <span className={`mt-0.5 block text-xs ${stageStatusClass(stage.status)}`}>{stage.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function NextActionCard({ action }: { action: ReturnType<typeof nextAction> }) {
  return (
    <Card className="!rounded-3xl border-[#eaeff2] !p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:!p-6">
      <div>
        <h2 className="text-lg font-bold text-text-primary">Next Action</h2>
        <p className="mt-1 text-[13px] text-text-secondary">Your next step to complete your accommodation.</p>
      </div>
      <div className="mt-4 flex items-center gap-4 rounded-xl bg-[#f7f9fa] px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-[#dcf1e9] text-primary">
          <CreditCard size={24} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[15px] font-bold text-text-primary">{action.label}</h3>
          <p className="mt-1 text-[13px] text-text-secondary">{action.description}</p>
        </div>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      </div>
      <Link
        to={action.href}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
      >
        Continue
        <ArrowRight size={16} aria-hidden="true" />
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
  icon: LucideIcon;
}

function recentActivity(data: DashboardData): ActivityItem[] {
  const application = latestApplicationSummary(data);
  const booking = latestBookingSummary(data);
  const allocation = data.allocation;
  return [
    application
      ? {
          key: "application",
          title: `Application ${statusLabel(application.status).toLowerCase()}`,
          detail: application.application_number,
          date: application.reviewed_at ?? application.submitted_at ?? application.created_at,
          color: "bg-[#dcf1e9] text-[#127b55]",
          icon: FileText
        }
      : null,
    booking
      ? {
          key: "booking",
          title: `Booking ${statusLabel(booking.status).toLowerCase()}`,
          detail: booking.booking_number,
          date: booking.booked_at ?? booking.created_at,
          color: "bg-[#efe9fb] text-[#6e48b9]",
          icon: CalendarCheck
        }
      : null,
    allocation
      ? {
          key: "allocation",
          title: "Room assigned",
          detail: `${allocation.room_code} · ${allocation.label ?? allocation.bed_code}`,
          date: allocation.starts_on ?? allocation.assigned_at,
          color: "bg-[#fdf0e6] text-[#c7691a]",
          icon: BedDouble
        }
      : null
  ].filter(Boolean) as ActivityItem[];
}

function RecentActivity({ data }: { data: DashboardData }) {
  const activity = recentActivity(data);
  return (
    <Card className="!rounded-3xl border-[#eaeff2] !p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:!p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Recent activity</h2>
          <p className="mt-1 text-[13px] text-text-secondary">Your latest accommodation activity</p>
        </div>
      </div>
      {activity.length ? (
        <div className="flex flex-col gap-5">
          {activity.map((item) => (
            <div key={item.key} className="flex items-start gap-3 sm:gap-4">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.color}`}>
                <item.icon size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="break-words text-sm font-semibold text-text-primary">{item.title}</p>
                  <p className="shrink-0 text-xs text-[#9aa7b1]">{formatDateTime(item.date)}</p>
                </div>
                <p className="mt-1 break-words text-[13px] leading-snug text-text-secondary">{item.detail}</p>
              </div>
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
    message
      ? {
          key: "message",
          title: message.subject,
          description: messagePreview(message, 90) || "No message body provided.",
          date: message.sent_at ?? message.delivered_at,
          unread: message.status === "unread",
          href: "/messages",
          icon: FileText,
          color: "bg-[#e6f2fb] text-[#1974d2]"
        }
      : null,
    announcement
      ? {
          key: "announcement",
          title: announcement.title,
          description: messagePreview({ body: announcement.body ?? "" }, 90) || "No announcement details provided.",
          date: announcement.published_at ?? announcement.starts_at,
          unread: false,
          href: "/announcements",
          icon: Megaphone,
          color: "bg-[#e6f2fb] text-[#1974d2]"
        }
      : null
  ].filter(Boolean) as Array<{
    key: string;
    title: string;
    description: string;
    date?: string | null;
    unread: boolean;
    href: string;
    icon: LucideIcon;
    color: string;
  }>;

  return (
    <Card className="!rounded-3xl border-[#eaeff2] !p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:!p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Updates</h2>
          <p className="mt-1 text-[13px] text-text-secondary">Latest hostel notices and messages</p>
        </div>
        <div className="flex items-center gap-2">
          {unread ? <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-primary">{unread} unread</span> : null}
          <Link to="/messages" className="hidden items-center gap-1 rounded-full bg-[#f3f6f8] px-3 py-2 text-[13px] font-semibold text-text-primary hover:bg-[#e8ecef] xl:inline-flex">
            View All
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
      {updates.length ? (
        <div className="flex flex-col gap-4">
          {updates.map((item) => (
            <Link key={item.key} to={item.href} className="flex items-start gap-3 rounded-xl hover:bg-[#fbfcfd] sm:gap-4">
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.color}`}>
                <item.icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="break-words text-sm font-semibold text-text-primary">{item.title}</span>
                  <span className="shrink-0 text-xs text-[#9aa7b1]">{formatDateTime(item.date)}</span>
                </span>
                <span className="mt-1 block text-[13px] text-text-secondary">{item.description}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No updates right now." message="Announcements and private messages will appear here." />
      )}
      <div className="mt-5 flex flex-wrap gap-4 xl:hidden">
        <Link to="/messages" className="text-sm font-semibold text-primary">
          View messages
        </Link>
        <Link to="/announcements" className="text-sm font-semibold text-primary">
          View announcements
        </Link>
      </div>
    </Card>
  );
}

function NeedHelpCard() {
  return (
    <Link
      to="/maintenance"
      className="group relative flex min-h-[88px] items-center gap-4 overflow-hidden rounded-3xl bg-primary px-6 py-6 text-white shadow-[0_10px_30px_rgba(5,98,104,0.22)] sm:px-8"
    >
      <span className="pointer-events-none absolute -right-5 -top-14 h-[200px] w-[150px] rounded-full bg-white/5" aria-hidden="true" />
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
        <Headset size={22} aria-hidden="true" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-base font-semibold">Need Help?</span>
        <span className="mt-1 block text-[13px] text-white/80">Report an issue or contact support.</span>
      </span>
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-primary transition group-hover:translate-x-1" aria-hidden="true">
        <ArrowRight size={16} />
      </span>
    </Link>
  );
}

export function HomePage() {
  const { data, isLoading, error, retry } = useResidentDashboard();
  usePageTitle("Home");
  const outletContext = useOutletContext<ResidentShellOutletContext | null>();

  useEffect(() => {
    if (!outletContext?.setChromeStatus) return;
    if (data?.profile.status) {
      outletContext.setChromeStatus(data.profile.status);
    } else {
      outletContext.setChromeStatus(null);
    }
    return () => outletContext.setChromeStatus(null);
  }, [data?.profile.status, outletContext]);

  if (isLoading) return <LoadingState label="Loading your dashboard" />;
  if (error || !data) {
    return <ErrorState title="Dashboard unavailable" message={error ?? "Unable to load your dashboard."} onRetry={() => void retry()} />;
  }

  const firstName = data.profile.first_name || "Resident";
  const action = nextAction(data);
  const journey = buildJourney(data);
  const institution = data.profile.institution_name ?? "Institution not available";
  const studentId = data.profile.student_id ?? "Student ID unavailable";

  return (
    <>
      <div className="xl:hidden">
        <PageHeader title="Home" description="Track your accommodation journey and what needs your attention." />
      </div>

      {data.partialErrors.length ? (
        <div className="mb-5">
          <ErrorState
            title="Some dashboard sections could not load"
            message={data.partialErrors.join(" ")}
            onRetry={() => void retry()}
            retryLabel="Retry failed sections"
          />
        </div>
      ) : null}

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between xl:mb-10">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold text-text-primary sm:text-[26px]">Hello, {firstName}!</h1>
          <p className="mt-1.5 text-sm text-text-secondary">Here&apos;s your accommodation overview.</p>
          <p className="mt-1.5 text-xs text-text-secondary sm:text-[13px]">
            {institution}
            <span className="mx-1.5 text-[#c5d3d0]" aria-hidden="true">
              •
            </span>
            {studentId}
          </p>
        </div>
        {/* Mobile/tablet status pill — desktop status lives in shell chrome */}
        <div className="xl:hidden">
          <StatusBadge status={data.profile.status} />
        </div>
      </div>

      <HomeStatusBar data={data} />

      {/*
        Desktop (xl): two columns — Journey/Activity/IA | NextAction/Updates/NeedHelp
        Tablet/small desktop (lg–xl): still usable two columns without sidebar
        Narrower: single column preserving mobile order
      */}
      <div className="mt-6 grid gap-5 sm:gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5 sm:space-y-6">
          <AccommodationJourney stages={journey} />
          <RecentActivity data={data} />
          <InternetAccessCard />
        </div>
        <div className="space-y-5 sm:space-y-6">
          <NextActionCard action={action} />
          <ResidentUpdates data={data} />
          <NeedHelpCard />
        </div>
      </div>

      <Card className="mt-5 !rounded-3xl border-[#eaeff2] !p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:!p-6 xl:hidden">
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
