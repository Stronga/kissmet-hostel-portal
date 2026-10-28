import { describe, expect, it } from "vitest";
import {
  agreementObligationMinor,
  arrangementMinimumMinor,
  computeAgreementFinancial,
  isPartialPaymentAuthorized,
} from "./agreement-financial";

describe("agreement-financial helpers", () => {
  it("computes obligation as accommodation + maintenance", () => {
    expect(agreementObligationMinor({ total_amount_minor: 600000, maintenance_fee_minor: 50000 })).toBe(650000);
    expect(agreementObligationMinor({ total_amount_minor: 600000, maintenance_fee_minor: null })).toBe(600000);
  });

  it("counts verified only in balance and allows negative historical overpayment display", () => {
    const financial = computeAgreementFinancial(
      { total_amount_minor: 600000, maintenance_fee_minor: 50000 },
      700000
    );
    expect(financial).toMatchObject({
      agreed_accommodation_amount_minor: 600000,
      maintenance_fee_minor: 50000,
      total_obligation_minor: 650000,
      verified_paid_minor: 700000,
      balance_minor: -50000
    });
  });

  it("derives arrangement minimum for fixed and percentage partial policies", () => {
    expect(arrangementMinimumMinor(650000, {
      partial_payment_authorized: 0,
      payment_requirement_type: "full"
    })).toBe(650000);
    expect(arrangementMinimumMinor(650000, {
      partial_payment_authorized: 1,
      payment_requirement_type: "fixed",
      payment_fixed_amount_minor: 300000
    })).toBe(300000);
    expect(arrangementMinimumMinor(650000, {
      partial_payment_authorized: 1,
      payment_requirement_type: "percentage",
      payment_percentage_basis_points: 5000
    })).toBe(325000);
  });

  it("detects partial authorization flag", () => {
    expect(isPartialPaymentAuthorized({ partial_payment_authorized: 1 })).toBe(true);
    expect(isPartialPaymentAuthorized({ partial_payment_authorized: 0 })).toBe(false);
  });
});
