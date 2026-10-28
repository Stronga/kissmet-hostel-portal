import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { LeasePeriod, RateCard, RateCardOccupancyCapacity } from "../../types/api";
import { parseMoneyToMinorUnits } from "../../utils/money";
import { leaseKindLabel, OCCUPANCY_OPTIONS } from "./setupLabels";

const statuses = ["draft", "active", "inactive", "archived"] as const;

function minorToInput(amountMinor: number) {
  const whole = Math.floor(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, "0");
  return `${whole}.${cents}`;
}

export type RateCardCreateInput = {
  leasePeriodId: number;
  occupancyCapacity: RateCardOccupancyCapacity;
  rateCode: string;
  amountMinor: number;
  currency: string;
  packageMonths?: number | null;
  status: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string | null;
};

export type RateCardUpdateInput = {
  amountMinor: number;
  packageMonths?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string | null;
};

export function RateCardFormDialog({
  open,
  mode,
  initial,
  leasePeriods,
  saving,
  error,
  onClose,
  onCreate,
  onUpdate
}: {
  open: boolean;
  mode: "create" | "edit";
  initial?: RateCard | null;
  leasePeriods: LeasePeriod[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: RateCardCreateInput) => void;
  onUpdate: (input: RateCardUpdateInput) => void;
}) {
  const [leasePeriodId, setLeasePeriodId] = useState("");
  const [occupancy, setOccupancy] = useState<string>("1");
  const [rateCode, setRateCode] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [packageMonths, setPackageMonths] = useState("");
  const [status, setStatus] = useState("draft");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const selectedPeriod = useMemo(
    () => leasePeriods.find((period) => String(period.id) === leasePeriodId) ?? null,
    [leasePeriods, leasePeriodId]
  );
  const showPackageMonths = selectedPeriod?.kind === "short_term" || Boolean(packageMonths) || (mode === "edit" && initial?.package_months != null);

  useEffect(() => {
    if (!open) {
      setLeasePeriodId("");
      setOccupancy("1");
      setRateCode("");
      setAmount("");
      setCurrency("GHS");
      setPackageMonths("");
      setStatus("draft");
      setEffectiveFrom("");
      setEffectiveTo("");
      setNotes("");
      setLocalError(null);
      return;
    }
    if (mode === "edit" && initial) {
      setLeasePeriodId(String(initial.lease_period_id));
      setOccupancy(String(initial.occupancy_capacity));
      setRateCode(initial.rate_code);
      setAmount(minorToInput(initial.amount_minor));
      setCurrency(initial.currency || "GHS");
      setPackageMonths(initial.package_months == null ? "" : String(initial.package_months));
      setStatus(String(initial.status));
      setEffectiveFrom(initial.effective_from ?? "");
      setEffectiveTo(initial.effective_to ?? "");
      setNotes(initial.notes ?? "");
      setLocalError(null);
    } else if (mode === "create" && leasePeriods.length === 1) {
      setLeasePeriodId(String(leasePeriods[0].id));
    }
  }, [open, mode, initial, leasePeriods]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    try {
      if (mode === "create" && (!leasePeriodId || !rateCode.trim() || !amount.trim())) {
        throw new Error("Lease period, rate code and amount are required.");
      }
      if (mode === "edit" && !amount.trim()) {
        throw new Error("Amount is required.");
      }
      if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
        throw new Error("Effective from must be on or before effective to.");
      }
      const amountMinor = parseMoneyToMinorUnits(amount);
      if (amountMinor <= 0) throw new Error("Amount must be greater than zero.");
      const months = packageMonths.trim() === "" ? null : Number(packageMonths);
      if (months != null && (!Number.isInteger(months) || months <= 0)) {
        throw new Error("Package months must be a positive whole number.");
      }
      if (mode === "create") {
        const occupancyCapacity = Number(occupancy) as RateCardOccupancyCapacity;
        if (![1, 2, 4].includes(occupancyCapacity)) throw new Error("Occupancy must be 1, 2, or 4 persons.");
        onCreate({
          leasePeriodId: Number(leasePeriodId),
          occupancyCapacity,
          rateCode: rateCode.trim(),
          amountMinor,
          currency: currency.trim().toUpperCase() || "GHS",
          packageMonths: months,
          status,
          effectiveFrom: effectiveFrom || null,
          effectiveTo: effectiveTo || null,
          notes: notes.trim() || null
        });
        return;
      }
      onUpdate({
        amountMinor,
        packageMonths: months,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        notes: notes.trim() || null
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Invalid rate card.");
    }
  }

  const title = mode === "create" ? "Create Rate Card" : "Edit Rate Card";
  const description = "A rate card is the default list price for a lease period and occupancy. Changes apply to future agreements only and do not change existing resident agreements.";

  return (
    <ConfirmDialog open={open} title={title} description={description} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-text-secondary">
          Changes to default rates apply to future agreements and do not change existing resident agreements.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Lease Period
            <select
              aria-label="Lease Period"
              value={leasePeriodId}
              disabled={mode === "edit"}
              onChange={(event) => setLeasePeriodId(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 disabled:bg-muted"
            >
              <option value="">Select lease period</option>
              {leasePeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name} ({leaseKindLabel(period.kind)}) — {period.code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Occupancy
            <select
              aria-label="Occupancy"
              value={occupancy}
              disabled={mode === "edit"}
              onChange={(event) => setOccupancy(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 disabled:bg-muted"
            >
              {OCCUPANCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Rate Code
            <input
              aria-label="Rate Code"
              value={rateCode}
              disabled={mode === "edit"}
              onChange={(event) => setRateCode(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 disabled:bg-muted"
            />
          </label>
          <label className="text-sm font-medium">
            Amount per resident
            <input
              aria-label="Amount per resident"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="9000.00"
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
            <span className="mt-1 block text-xs font-normal text-text-secondary">Enter a normal currency amount. It is converted to minor units before saving.</span>
          </label>
          <label className="text-sm font-medium">
            Currency
            <input
              aria-label="Currency"
              value={currency}
              disabled={mode === "edit"}
              onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 disabled:bg-muted"
            />
          </label>
          {showPackageMonths || selectedPeriod?.kind === "short_term" ? (
            <label className="text-sm font-medium">
              Package months
              <input
                aria-label="Package months"
                inputMode="numeric"
                value={packageMonths}
                onChange={(event) => setPackageMonths(event.target.value)}
                placeholder="e.g. 3"
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              />
              <span className="mt-1 block text-xs font-normal text-text-secondary">
                Optional package length for Short-Term pricing. Leave blank when not applicable.
              </span>
            </label>
          ) : null}
          {mode === "create" ? (
            <label className="text-sm font-medium">
              Status
              <select
                aria-label="Rate Card status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              >
                {statuses.map((item) => (
                  <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-sm font-medium">
            Effective from
            <input
              aria-label="Effective from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Effective to
            <input
              aria-label="Effective to"
              type="date"
              value={effectiveTo}
              onChange={(event) => setEffectiveTo(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Notes
            <input
              aria-label="Rate Card Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
        </div>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Saving..." : mode === "create" ? "Create Rate Card" : "Save Changes"}
          </button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
