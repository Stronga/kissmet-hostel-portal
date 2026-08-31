import type { Booking, Payment, PaymentMethod, Resident } from "../../types/api";

export const paymentMethods: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" }
];

export function methodLabel(method: string | null | undefined) {
  return paymentMethods.find((item) => item.value === method)?.label ?? "Unknown";
}

export function residentName(resident?: Resident) {
  return resident ? `${resident.first_name} ${resident.last_name}` : "Resident unavailable";
}

export function paymentBooking(payment: Payment, bookingsById: Map<number, Booking>) {
  return payment.booking_id ? bookingsById.get(payment.booking_id) : undefined;
}

export function canSubmit(payment: Payment) {
  return payment.status === "pending";
}

export function canCancel(payment: Payment) {
  return payment.status === "pending" || payment.status === "submitted";
}

export function canVerify(payment: Payment) {
  return payment.status === "submitted";
}

export function canReject(payment: Payment) {
  return payment.status === "submitted";
}

export function canRefund(payment: Payment) {
  return payment.status === "verified";
}

export function canArchive(payment: Payment) {
  return ["rejected", "refunded", "cancelled"].includes(payment.status);
}
