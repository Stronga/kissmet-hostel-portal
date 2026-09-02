import type { DashboardData, ResidentApplication, ResidentBooking } from "../types/resident";
import { isDocumentUploaded, latestIdentityDocuments } from "./documents";
import { formatMoneyMinor, statusLabel } from "./format";

export interface JourneyStage {
  key: string;
  label: string;
  status: "complete" | "current" | "pending" | "attention";
  detail: string;
}

export interface NextAction {
  label: string;
  description: string;
  href: string;
}

function latestApplication(applications: ResidentApplication[]) {
  return [...applications].sort((a, b) => b.id - a.id)[0] ?? null;
}

function latestBooking(bookings: ResidentBooking[]) {
  return [...bookings].sort((a, b) => b.id - a.id)[0] ?? null;
}

function hasRequiredIdentityDocuments(data: DashboardData) {
  const docs = latestIdentityDocuments(data.documents);
  return isDocumentUploaded(docs.student_card) && isDocumentUploaded(docs.ghana_card);
}

function missingDocumentLabels(data: DashboardData) {
  const docs = latestIdentityDocuments(data.documents);
  return [
    !isDocumentUploaded(docs.student_card) ? "Student Card" : null,
    !isDocumentUploaded(docs.ghana_card) ? "Ghana Card" : null
  ].filter(Boolean) as string[];
}

export function buildJourney(data: DashboardData): JourneyStage[] {
  const app = latestApplication(data.applications);
  const booking = latestBooking(data.bookings);
  const docsReady = hasRequiredIdentityDocuments(data);
  const appApproved = app?.status === "approved";
  const bookingReady = booking && ["pending", "confirmed", "completed"].includes(booking.status);
  const missingDocs = missingDocumentLabels(data);
  return [
    { key: "account", label: "Account", status: "complete", detail: statusLabel(data.profile.status) },
    { key: "documents", label: "Documents", status: docsReady ? "complete" : "current", detail: docsReady ? "Required documents uploaded" : `${missingDocs.join(" and ")} required` },
    { key: "application", label: "Application", status: app ? app.status === "rejected" ? "attention" : appApproved ? "complete" : "current" : "pending", detail: app ? statusLabel(app.status) : "Not started" },
    { key: "booking", label: "Booking", status: bookingReady ? booking.status === "confirmed" || booking.status === "completed" ? "complete" : "current" : "pending", detail: booking ? statusLabel(booking.status) : "No active booking" },
    { key: "payment", label: "Payment", status: data.paymentSummary?.confirmationRequirementMet ? "complete" : booking ? "current" : "pending", detail: data.paymentSummary ? `Verified ${formatMoneyMinor(data.paymentSummary.verifiedTotalMinor, data.paymentSummary.currency)}` : booking ? "Payment required" : "Waiting for booking" },
    { key: "room", label: "Room Assignment", status: data.allocation ? "complete" : "pending", detail: data.allocation ? `${data.allocation.room_code} / ${data.allocation.label ?? data.allocation.bed_code}` : "Room assignment pending" }
  ];
}

export function nextAction(data: DashboardData): NextAction {
  const app = latestApplication(data.applications);
  const booking = latestBooking(data.bookings);
  if (!hasRequiredIdentityDocuments(data)) {
    const missing = missingDocumentLabels(data);
    const target = missing.length === 1 ? missing[0] : "required documents";
    return { label: `Upload your ${target}`, description: "Student Card and Ghana Card uploads are required before application submission.", href: "/documents" };
  }
  if (!app) return { label: "Start your hostel application", description: "Create your application for the active academic session when applications open.", href: "/application" };
  if (app.status === "draft") return { label: "Continue your draft application", description: "Review and submit your draft application.", href: "/application" };
  if (app.status === "submitted" || app.status === "under_review") return { label: "Wait for application review", description: "Kissmet staff will review your submitted application.", href: "/application" };
  if (app.status === "rejected") return { label: "Review your application decision", description: "Check the application area for the latest decision information.", href: "/application" };
  if (app.status === "approved" && !booking) return { label: "Review your approved application", description: "Booking will follow approval through the hostel workflow.", href: "/booking" };
  if (booking?.status === "pending" && data.paymentSummary?.confirmationRequirementMet) return { label: "Await booking confirmation", description: "Payment requirement is met. Booking confirmation remains a staff action.", href: "/booking" };
  if (booking?.status === "pending") return { label: "Review your booking and payment requirements", description: "A pending booking requires payment verification before confirmation.", href: "/payments" };
  if (booking?.status === "confirmed" && !data.allocation) return { label: "Wait for room assignment", description: "Your booking is confirmed. Room assignment will appear after allocation.", href: "/room" };
  if (data.allocation) return { label: "View your room assignment", description: "Your current room and bed assignment is available.", href: "/room" };
  return { label: "Check your hostel status", description: "Your latest resident information is available in the portal.", href: "/profile" };
}

export function latestApplicationSummary(data: DashboardData) {
  return latestApplication(data.applications);
}

export function latestBookingSummary(data: DashboardData) {
  return latestBooking(data.bookings);
}
