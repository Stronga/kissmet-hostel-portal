/**
 * Stage 2L-J: reusable authoritative agreement financial calculation.
 * Accommodation = bookings.total_amount_minor (snapshot).
 * Maintenance = bookings.maintenance_fee_minor (non-refundable, or 0 when null).
 * Obligation = accommodation + maintenance.
 * Verified paid = sum of payments with status = 'verified' only.
 * Balance = obligation - verifiedPaid (may be negative if historical overpayment exists).
 */

export type AgreementFinancialBasis = {
  agreed_accommodation_amount_minor: number;
  maintenance_fee_minor: number | null;
  total_obligation_minor: number;
  verified_paid_minor: number;
  balance_minor: number;
};

export function accommodationAmountMinor(booking: { total_amount_minor?: unknown }): number {
  return Number(booking.total_amount_minor ?? 0);
}

export function maintenanceAmountMinor(booking: { maintenance_fee_minor?: unknown }): number {
  return booking.maintenance_fee_minor == null ? 0 : Number(booking.maintenance_fee_minor);
}

export function agreementObligationMinor(booking: {
  total_amount_minor?: unknown;
  maintenance_fee_minor?: unknown;
}): number {
  return accommodationAmountMinor(booking) + maintenanceAmountMinor(booking);
}

export function computeAgreementFinancial(
  booking: { total_amount_minor?: unknown; maintenance_fee_minor?: unknown },
  verifiedPaidMinor: number
): AgreementFinancialBasis {
  const accommodation = accommodationAmountMinor(booking);
  const maintenanceRaw = booking.maintenance_fee_minor == null ? null : maintenanceAmountMinor(booking);
  const maintenanceForObligation = maintenanceRaw ?? 0;
  const obligation = accommodation + maintenanceForObligation;
  const verified = Number(verifiedPaidMinor ?? 0);
  return {
    agreed_accommodation_amount_minor: accommodation,
    maintenance_fee_minor: maintenanceRaw,
    total_obligation_minor: obligation,
    verified_paid_minor: verified,
    balance_minor: obligation - verified,
  };
}

/** Minimum initial amount implied by per-agreement payment arrangement (0 when full / unset). */
export function arrangementMinimumMinor(
  obligationMinor: number,
  policy: {
    partial_payment_authorized?: unknown;
    payment_requirement_type?: unknown;
    payment_fixed_amount_minor?: unknown;
    payment_percentage_basis_points?: unknown;
  }
): number {
  if (Number(policy.partial_payment_authorized ?? 0) !== 1) return obligationMinor;
  const type = policy.payment_requirement_type;
  if (type === "fixed") {
    const fixed = Number(policy.payment_fixed_amount_minor ?? 0);
    if (!Number.isFinite(fixed) || fixed <= 0) return 1;
    return Math.min(fixed, obligationMinor);
  }
  if (type === "percentage") {
    const bps = Number(policy.payment_percentage_basis_points ?? 0);
    if (!Number.isFinite(bps) || bps <= 0) return 1;
    return Math.min(Math.ceil((obligationMinor * bps) / 10000), obligationMinor);
  }
  // partial authorized but type missing/full — treat as any positive amount allowed
  return 1;
}

export function isPartialPaymentAuthorized(booking: { partial_payment_authorized?: unknown }): boolean {
  return Number(booking.partial_payment_authorized ?? 0) === 1;
}
