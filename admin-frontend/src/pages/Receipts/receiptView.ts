import type { Booking, Payment, Receipt, ReceiptDetailData, Resident } from "../../types/api";

export function receiptAmount(receipt: Receipt | ReceiptDetailData, payment?: Payment) {
  return "amount_minor" in receipt ? receipt.amount_minor : payment?.amount_minor;
}

export function receiptCurrency(receipt: Receipt | ReceiptDetailData, payment?: Payment) {
  return "amount_minor" in receipt ? "GHS" : payment?.currency;
}

export function receiptPayment(receipt: Receipt, paymentsById: Map<number, Payment>) {
  return paymentsById.get(receipt.payment_id);
}

export function receiptBooking(receipt: Receipt, paymentsById: Map<number, Payment>, bookingsById: Map<number, Booking>) {
  const payment = receiptPayment(receipt, paymentsById);
  return payment?.booking_id ? bookingsById.get(payment.booking_id) : undefined;
}

export function receiptResident(receipt: Receipt, paymentsById: Map<number, Payment>, residentsById: Map<number, Resident>) {
  const payment = receiptPayment(receipt, paymentsById);
  return payment ? residentsById.get(payment.resident_id) : undefined;
}

export function residentName(resident?: Resident) {
  return resident ? `${resident.first_name} ${resident.last_name}` : "Not available";
}
