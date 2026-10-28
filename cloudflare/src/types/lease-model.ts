/**
 * Stage 2L-B schema foundation types for flexible lease periods, rate cards,
 * and booking agreement snapshot columns. APIs/UI arrive in later stages.
 */

export const LEASE_KINDS = ["academic_calendar", "calendar_year", "short_term"] as const;
export type LeaseKind = (typeof LEASE_KINDS)[number];

export const LEASE_PERIOD_STATUSES = ["draft", "active", "closed", "archived"] as const;
export type LeasePeriodStatus = (typeof LEASE_PERIOD_STATUSES)[number];

export const RATE_CARD_STATUSES = ["draft", "active", "inactive", "archived"] as const;
export type RateCardStatus = (typeof RATE_CARD_STATUSES)[number];

/** Supported room occupancy bands for default/list pricing. */
export const RATE_CARD_OCCUPANCY_CAPACITIES = [1, 2, 4] as const;
export type RateCardOccupancyCapacity = (typeof RATE_CARD_OCCUPANCY_CAPACITIES)[number];

export const BOOKING_PAYMENT_REQUIREMENT_TYPES = ["full", "fixed", "percentage"] as const;
export type BookingPaymentRequirementType = (typeof BOOKING_PAYMENT_REQUIREMENT_TYPES)[number];

export interface LeasePeriodRow {
  id: number;
  kind: LeaseKind;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: LeasePeriodStatus;
  /** Optional link for academic_calendar periods only; null for CY/ST. */
  academic_session_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * Default/list price for a lease period + occupancy capacity.
 * Independent of bookings.total_amount_minor (agreed accommodation snapshot).
 */
export interface RateCardRow {
  id: number;
  lease_period_id: number;
  occupancy_capacity: RateCardOccupancyCapacity;
  rate_code: string;
  amount_minor: number;
  currency: string;
  /** Optional short-term package length in months (e.g. 3). Null for non-package cards. */
  package_months: number | null;
  status: RateCardStatus;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * Additive agreement fields on bookings (Stage 2L-B).
 * Authoritative agreed accommodation fee remains `total_amount_minor`.
 * `maintenance_fee_minor` is a separate non-refundable snapshot.
 */
export interface BookingAgreementFields {
  lease_period_id: number | null;
  lease_kind: LeaseKind | null;
  starts_on: string | null;
  ends_on: string | null;
  maintenance_fee_minor: number | null;
  payment_requirement_type: BookingPaymentRequirementType | null;
  payment_fixed_amount_minor: number | null;
  payment_percentage_basis_points: number | null;
  partial_payment_authorized: 0 | 1;
  prior_booking_id: number | null;
  override_reason: string | null;
}

export function isLeaseKind(value: unknown): value is LeaseKind {
  return typeof value === "string" && (LEASE_KINDS as readonly string[]).includes(value);
}

export function isRateCardOccupancyCapacity(value: unknown): value is RateCardOccupancyCapacity {
  return typeof value === "number" && (RATE_CARD_OCCUPANCY_CAPACITIES as readonly number[]).includes(value);
}
