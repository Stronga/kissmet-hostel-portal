import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { Booking, LeasePeriod, Room } from "../../types/api";
import { formatCurrencyMinor, formatStatus } from "../../utils/format";
import { parseMoneyToMinorUnits } from "../../utils/money";

function leaseLabel(kind?: string | null) {
  if (kind === "calendar_year") return "Calendar Year";
  if (kind === "short_term") return "Short-Term";
  if (kind === "academic_calendar") return "Academic Calendar";
  return kind || "Not set";
}

export function RenewAgreementDialog({
  open,
  prior,
  rooms,
  leasePeriods,
  balanceMinor,
  verifiedPaidMinor,
  saving,
  error,
  onClose,
  onRenew
}: {
  open: boolean;
  prior: Booking;
  rooms: Room[];
  leasePeriods: LeasePeriod[];
  balanceMinor?: number | null;
  verifiedPaidMinor?: number | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onRenew: (input: {
    roomId: number;
    leasePeriodId: number;
    startsOn?: string;
    endsOn?: string;
    maintenanceFeeMinor: number;
    agreedAmountMinor?: number;
    overrideReason?: string;
    reason: string;
  }) => void;
}) {
  const activePeriods = useMemo(() => leasePeriods.filter((p) => p.status === "active"), [leasePeriods]);
  const [leasePeriodId, setLeasePeriodId] = useState("");
  const [roomId, setRoomId] = useState(prior.priced_room_id ? String(prior.priced_room_id) : "");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [maintenanceMajor, setMaintenanceMajor] = useState("0");
  const [overrideMajor, setOverrideMajor] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeasePeriodId("");
    setRoomId(prior.priced_room_id ? String(prior.priced_room_id) : "");
    setStartsOn("");
    setEndsOn("");
    setMaintenanceMajor("0");
    setOverrideMajor("");
    setOverrideReason("");
    setReason("");
    setFormError(null);
  }, [open, prior]);

  useEffect(() => {
    const period = activePeriods.find((p) => p.id === Number(leasePeriodId));
    if (!period) return;
    setStartsOn(period.starts_on ?? "");
    setEndsOn(period.ends_on ?? "");
  }, [leasePeriodId, activePeriods]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!leasePeriodId || !roomId) {
      setFormError("Select a lease period and room.");
      return;
    }
    if (!reason.trim()) {
      setFormError("A management reason is required.");
      return;
    }
    let maintenanceFeeMinor = 0;
    try {
      maintenanceFeeMinor = parseMoneyToMinorUnits(maintenanceMajor || "0");
    } catch {
      setFormError("Enter a valid maintenance fee.");
      return;
    }
    let agreedAmountMinor: number | undefined;
    if (overrideMajor.trim()) {
      try {
        agreedAmountMinor = parseMoneyToMinorUnits(overrideMajor);
      } catch {
        setFormError("Enter a valid override amount.");
        return;
      }
      if (!overrideReason.trim()) {
        setFormError("Override reason is required when the agreed amount differs from the rate card.");
        return;
      }
    }
    onRenew({
      roomId: Number(roomId),
      leasePeriodId: Number(leasePeriodId),
      startsOn: startsOn || undefined,
      endsOn: endsOn || undefined,
      maintenanceFeeMinor,
      agreedAmountMinor,
      overrideReason: overrideReason.trim() || undefined,
      reason: reason.trim()
    });
  }

  return (
    <ConfirmDialog open={open} title="Renew Agreement" description="Creates a new agreement linked to this prior booking. The prior agreement is preserved. Full payment is the default; old payments and partial authorization do not carry over. No bed is allocated automatically." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <section className="rounded border border-border p-3 text-sm">
          <p className="text-xs font-semibold uppercase text-text-secondary">Prior agreement</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div><dt className="text-xs text-text-secondary">Booking</dt><dd className="font-medium">{prior.booking_number}</dd></div>
            <div><dt className="text-xs text-text-secondary">Status</dt><dd className="font-medium">{formatStatus(prior.status)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Approved term</dt><dd className="font-medium">{leaseLabel(prior.lease_kind)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Dates</dt><dd className="font-medium">{prior.starts_on || "—"} → {prior.ends_on || "—"}</dd></div>
            <div><dt className="text-xs text-text-secondary">Accommodation</dt><dd className="font-medium">{formatCurrencyMinor(prior.total_amount_minor, prior.currency)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Maintenance</dt><dd className="font-medium">{prior.maintenance_fee_minor == null ? "Not set" : formatCurrencyMinor(prior.maintenance_fee_minor, prior.currency)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Verified paid</dt><dd className="font-medium">{verifiedPaidMinor == null ? "—" : formatCurrencyMinor(verifiedPaidMinor, prior.currency)}</dd></div>
            <div><dt className="text-xs text-text-secondary">Balance</dt><dd className="font-medium">{balanceMinor == null ? "—" : formatCurrencyMinor(balanceMinor, prior.currency)}</dd></div>
          </dl>
        </section>
        <label className="block text-sm font-medium">New lease period
          <select aria-label="Renewal lease period" value={leasePeriodId} onChange={(e) => setLeasePeriodId(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">
            <option value="">Select lease period</option>
            {activePeriods.map((p) => <option key={p.id} value={p.id}>{p.name} ({leaseLabel(p.kind)})</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Room
          <select aria-label="Renewal room" value={roomId} onChange={(e) => setRoomId(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">
            <option value="">Select room</option>
            {rooms.filter((r) => r.status === "available").map((r) => <option key={r.id} value={r.id}>{r.room_code}{r.room_name ? ` — ${r.room_name}` : ""} (cap {r.capacity})</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Starts on<input aria-label="Renewal starts on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="block text-sm font-medium">Ends on<input aria-label="Renewal ends on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        </div>
        <label className="block text-sm font-medium">Maintenance fee (GHS)
          <input aria-label="Renewal maintenance fee" value={maintenanceMajor} onChange={(e) => setMaintenanceMajor(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
        </label>
        <label className="block text-sm font-medium">Agreed amount override (optional, GHS)
          <input aria-label="Renewal amount override" value={overrideMajor} onChange={(e) => setOverrideMajor(e.target.value)} placeholder="Leave blank to use rate card" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
        </label>
        {overrideMajor.trim() ? (
          <label className="block text-sm font-medium">Override reason
            <input aria-label="Renewal override reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
          </label>
        ) : null}
        <p className="text-xs text-text-secondary">Partial payment is NOT authorized on the new agreement by default.</p>
        <label className="block text-sm font-medium">Management reason
          <textarea aria-label="Renewal reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" rows={2} />
        </label>
        {formError || error ? <p role="alert" className="text-sm font-medium text-danger">{formError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Renewal</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
