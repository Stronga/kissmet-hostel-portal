import type { ResidentPayment } from "../types/resident";
import { statusLabel } from "./format";

export const paymentMethods = ["cash", "bank_transfer", "mobile_money", "card", "other"] as const;
export const allowedSlipMimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const maxSlipSizeBytes = 5 * 1024 * 1024;

export function paymentStatusLabel(status?: string | null) {
  if (status === "submitted") return "Awaiting verification";
  return statusLabel(status);
}

export function methodLabel(method?: string | null) {
  return statusLabel(method);
}

export function parseGhsMinor(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function validatePaymentAmount(value: string, outstandingMinor?: number | null) {
  const minor = parseGhsMinor(value);
  if (!minor || minor <= 0) return "Enter an amount greater than zero.";
  if (outstandingMinor != null && minor > outstandingMinor) return "Payment amount cannot exceed the outstanding balance.";
  return null;
}

export function validatePaymentSlip(file: File | null) {
  if (!file) return "Choose a payment slip to upload.";
  if (!allowedSlipMimeTypes.includes(file.type)) return "Choose a PDF, JPEG, PNG, or WebP file.";
  if (file.size > maxSlipSizeBytes) return "The maximum file size is 5 MB.";
  return null;
}

export function latestPayment(payments: ResidentPayment[]) {
  return [...payments].sort((a, b) => b.id - a.id)[0] ?? null;
}
