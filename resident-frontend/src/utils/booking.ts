import type { ResidentAllocation, ResidentApplication, ResidentBooking } from "../types/resident";
import { latestApplication } from "./application";
import { formatMoneyMinor, statusLabel } from "./format";

const currentStatuses = new Set(["pending", "confirmed"]);

export function latestBooking(bookings: ResidentBooking[]) {
  return [...bookings].sort((a, b) => b.id - a.id)[0] ?? null;
}

export function currentBooking(bookings: ResidentBooking[]) {
  return [...bookings].filter((booking) => currentStatuses.has(booking.status)).sort((a, b) => b.id - a.id)[0] ?? null;
}

export function historicalBookings(bookings: ResidentBooking[]) {
  const current = currentBooking(bookings);
  return bookings.filter((booking) => booking.id !== current?.id);
}

export function bookingStatusLabel(status?: string | null) {
  return statusLabel(status);
}

export function pricedRoomLabel(booking?: ResidentBooking | null) {
  if (!booking?.priced_room_code && !booking?.priced_room_name) return null;
  return booking.priced_room_name ? `${booking.priced_room_code ?? ""} - ${booking.priced_room_name}`.trim().replace(/^-\s*/, "") : booking.priced_room_code ?? null;
}

export function bookingAmount(booking: ResidentBooking) {
  return formatMoneyMinor(booking.total_amount_minor, booking.currency);
}

export function bookingStatusDescription(booking?: ResidentBooking | null, allocation?: ResidentAllocation | null) {
  if (!booking) return "No booking has been created yet.";
  if (booking.status === "pending") return "Your booking has been created and is awaiting the remaining required steps.";
  if (booking.status === "confirmed" && allocation) return "Your booking has been confirmed and a room assignment is available.";
  if (booking.status === "confirmed") return "Your booking has been confirmed. No room or bed has been assigned yet.";
  if (booking.status === "cancelled") return "This booking was cancelled.";
  if (booking.status === "expired") return "This booking expired.";
  if (booking.status === "completed") return "This booking is complete.";
  if (booking.status === "archived") return "This booking is archived.";
  return "Your booking status is available.";
}

export function noBookingMessage(application?: ResidentApplication | null) {
  const app = application ?? null;
  if (!app) return "Start and submit an application before the booking stage.";
  if (app.status === "approved") return "Your application is approved. Booking creation and processing are handled according to the current hostel workflow.";
  return "Booking comes after application approval. Your current application is not yet approved.";
}

export function bookingNextStep(booking: ResidentBooking | null, application: ResidentApplication | null, allocation: ResidentAllocation | null) {
  if (!booking) {
    if (application?.status === "approved") return { label: "Waiting for booking", detail: "Hostel staff will process booking according to the current workflow.", href: "/application" };
    return { label: "Application comes first", detail: "Complete the application stage before booking.", href: "/application" };
  }
  if (booking.status === "pending") return { label: "Review payment requirements", detail: "Payment submission and verification are handled in the payment stage.", href: "/payments" };
  if (booking.status === "confirmed" && !allocation) return { label: "Waiting for room assignment", detail: "A confirmed booking does not mean a bed has been allocated.", href: "/room" };
  if (allocation) return { label: "View My Room", detail: "Your actual room and bed assignment comes from allocation.", href: "/room" };
  return { label: "Review booking status", detail: bookingStatusDescription(booking, allocation), href: "/booking" };
}

export function latestApplicationForBooking(applications: ResidentApplication[]) {
  return latestApplication(applications);
}
