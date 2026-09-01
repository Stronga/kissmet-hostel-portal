import { apiRequest } from "./client";
import type { DataEnvelope, PaymentConfirmationSetting, SettingsOverview, SystemSettingsGeneral } from "../types/api";

export interface UpdateGeneralSettingsInput {
  organizationName: string;
  adminPortalTitle: string;
  residentPortalTitle: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  addressText?: string | null;
  defaultCurrency?: string;
}

export interface UpdatePaymentConfirmationInput {
  requirementType: "full" | "fixed" | "percentage";
  fixedAmountMinor?: number | null;
  percentageBasisPoints?: number | null;
  currency?: string;
}

export async function getSettings() {
  return (await apiRequest<DataEnvelope<SettingsOverview>>("/admin/settings")).data;
}

export async function updateGeneralSettings(input: UpdateGeneralSettingsInput) {
  return (await apiRequest<DataEnvelope<SystemSettingsGeneral>>("/admin/settings/general", { method: "PATCH", body: JSON.stringify(input) })).data;
}

export async function updatePaymentConfirmation(input: UpdatePaymentConfirmationInput) {
  return (await apiRequest<DataEnvelope<PaymentConfirmationSetting>>("/admin/settings/payment-confirmation", { method: "PATCH", body: JSON.stringify(input) })).data;
}
