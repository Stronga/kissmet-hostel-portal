import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { Application, LeasePeriod, RateCard, Room } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

function termLabel(kind?: string | null) {
  if (kind === "calendar_year") return "Calendar Year";
  if (kind === "short_term") return "Short-Term";
  if (kind === "academic_calendar") return "Academic Calendar";
  return "Not set";
}

export function CreateAgreementDialog({
  open,
  application,
  leasePeriods,
  rooms,
  resolvingRate,
  resolvedRate,
  rateError,
  error,
  saving,
  onLeasePeriodChange,
  onRoomChange,
  onResolveRate,
  onCreate,
  onClose
}: {
  open: boolean;
  application: Application;
  leasePeriods: LeasePeriod[];
  rooms: Room[];
  resolvingRate: boolean;
  resolvedRate: RateCard | null;
  rateError: string | null;
  error: string | null;
  saving: boolean;
  onLeasePeriodChange: (leasePeriodId: number | null) => void;
  onRoomChange: (roomId: number | null) => void;
  onResolveRate: (leasePeriodId: number, occupancyCapacity: number) => void;
  onCreate: (input: {
    leasePeriodId: number;
    roomId: number;
    occupancyCapacity: number;
    maintenanceFeeMinor: number;
    agreedAmountMinor: number;
    overrideReason?: string | null;
    startsOn: string;
    endsOn: string;
  }) => void;
  onClose: () => void;
}) {
  const activePeriods = useMemo(
    () => leasePeriods.filter((period) => period.status === "active"),
    [leasePeriods]
  );
  const availableRooms = useMemo(
    () => rooms.filter((room) => room.status === "available" || room.status === "occupied" || room.status === "maintenance"),
    [rooms]
  );

  const [leasePeriodId, setLeasePeriodId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [maintenanceFee, setMaintenanceFee] = useState("0");
  const [agreedAmount, setAgreedAmount] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  const selectedPeriod = activePeriods.find((period) => period.id === Number(leasePeriodId));
  const selectedRoom = availableRooms.find((room) => room.id === Number(roomId));
  const defaultAmount = resolvedRate ? Number(resolvedRate.amount_minor) : null;
  const agreedMinor = agreedAmount === "" ? defaultAmount : Number(agreedAmount);
  const needsOverrideReason =
    defaultAmount != null && agreedMinor != null && Number.isFinite(agreedMinor) && agreedMinor !== defaultAmount;

  useEffect(() => {
    if (!open) return;
    const preferred = application.lease_period_id
      ? activePeriods.find((period) => period.id === application.lease_period_id)
      : activePeriods.find((period) => period.kind === (application.lease_kind ?? "academic_calendar"));
    const period = preferred ?? activePeriods[0] ?? null;
    setLeasePeriodId(period ? String(period.id) : "");
    setRoomId("");
    setMaintenanceFee("0");
    setAgreedAmount("");
    setOverrideReason("");
    setStartsOn(period?.starts_on ?? "");
    setEndsOn(period?.ends_on ?? "");
    onLeasePeriodChange(period?.id ?? null);
    onRoomChange(null);
  }, [open, application.id]);

  useEffect(() => {
    if (!selectedPeriod) return;
    setStartsOn(selectedPeriod.starts_on);
    setEndsOn(selectedPeriod.ends_on);
    onLeasePeriodChange(selectedPeriod.id);
  }, [selectedPeriod?.id]);

  useEffect(() => {
    onRoomChange(selectedRoom?.id ?? null);
  }, [selectedRoom?.id]);

  useEffect(() => {
    if (selectedPeriod && selectedRoom) onResolveRate(selectedPeriod.id, Number(selectedRoom.capacity));
  }, [selectedPeriod?.id, selectedRoom?.id]);

  useEffect(() => {
    if (resolvedRate && agreedAmount === "") {
      setAgreedAmount(String(resolvedRate.amount_minor));
    }
  }, [resolvedRate?.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedPeriod || !selectedRoom || agreedMinor == null || !Number.isInteger(agreedMinor)) return;
    const maintenanceFeeMinor = Number(maintenanceFee);
    if (!Number.isInteger(maintenanceFeeMinor) || maintenanceFeeMinor < 0) return;
    onCreate({
      leasePeriodId: selectedPeriod.id,
      roomId: selectedRoom.id,
      occupancyCapacity: Number(selectedRoom.capacity),
      maintenanceFeeMinor,
      agreedAmountMinor: agreedMinor,
      overrideReason: needsOverrideReason ? overrideReason : null,
      startsOn,
      endsOn
    });
  }

  return (
    <ConfirmDialog
      open={open}
      title="Create Agreement"
      description="Management sets the approved commercial agreement. The applicant request remains unchanged."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <section className="rounded border border-border p-3 text-sm">
          <h4 className="font-semibold text-text-primary">REQUEST</h4>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-secondary">Requested Term</dt>
              <dd className="font-medium">{termLabel(application.lease_kind)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Requested Lease Period</dt>
              <dd className="font-medium">
                {application.lease_period_id
                  ? (leasePeriods.find((period) => period.id === application.lease_period_id)?.name ?? `#${application.lease_period_id}`)
                  : "Not linked"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Academic Session</dt>
              <dd className="font-medium">
                {application.academic_session_id == null ? "Not applicable for this request" : `Session #${application.academic_session_id}`}
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3 rounded border border-border p-3">
          <h4 className="text-sm font-semibold text-text-primary">MANAGEMENT AGREEMENT</h4>
          <div>
            <label htmlFor="agreement-lease-period" className="block text-sm font-medium">Lease Period</label>
            <select
              id="agreement-lease-period"
              value={leasePeriodId}
              onChange={(event) => {
                setLeasePeriodId(event.target.value);
                setAgreedAmount("");
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="">Select lease period</option>
              {activePeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {termLabel(period.kind)} — {period.name}
                </option>
              ))}
            </select>
          </div>
          {selectedPeriod ? (
            <p className="text-xs text-text-secondary">
              Approved Term: <strong>{termLabel(selectedPeriod.kind)}</strong>
              {selectedPeriod.kind !== "academic_calendar"
                ? " · Academic Session not required"
                : selectedPeriod.academic_session_id
                  ? ` · Academic Session #${selectedPeriod.academic_session_id}`
                  : " · No academic session linked on this period"}
            </p>
          ) : null}
          <div>
            <label htmlFor="agreement-room" className="block text-sm font-medium">Room</label>
            <select
              id="agreement-room"
              value={roomId}
              onChange={(event) => {
                setRoomId(event.target.value);
                setAgreedAmount("");
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="">Select room</option>
              {availableRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.room_code}{room.room_name ? ` — ${room.room_name}` : ""} (capacity {room.capacity})
                </option>
              ))}
            </select>
          </div>
          {selectedRoom ? (
            <p className="text-sm">Occupancy band: <strong>{selectedRoom.capacity} person{Number(selectedRoom.capacity) === 1 ? "" : "s"}</strong></p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="agreement-starts" className="block text-sm font-medium">Starts on</label>
              <input id="agreement-starts" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="agreement-ends" className="block text-sm font-medium">Ends on</label>
              <input id="agreement-ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="rounded border border-dashed border-border p-3 text-sm">
            <p className="font-medium">Applicable Rate Card</p>
            {resolvingRate ? <p className="text-text-secondary">Resolving active rate…</p> : null}
            {rateError ? <p role="alert" className="text-danger">{rateError}</p> : null}
            {!resolvingRate && !rateError && resolvedRate ? (
              <p>
                {resolvedRate.rate_code}: {formatCurrencyMinor(resolvedRate.amount_minor, resolvedRate.currency)}
              </p>
            ) : null}
            {!resolvingRate && !rateError && !resolvedRate && selectedPeriod && selectedRoom ? (
              <p className="text-danger">No active rate configured</p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="agreement-amount" className="block text-sm font-medium">Agreed Accommodation (minor units)</label>
              <input
                id="agreement-amount"
                inputMode="numeric"
                value={agreedAmount}
                onChange={(event) => setAgreedAmount(event.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
              {defaultAmount != null ? (
                <p className="mt-1 text-xs text-text-secondary">Default from rate card: {formatCurrencyMinor(defaultAmount, resolvedRate?.currency ?? "GHS")}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="agreement-maintenance" className="block text-sm font-medium">Maintenance Fee (minor units)</label>
              <input
                id="agreement-maintenance"
                inputMode="numeric"
                value={maintenanceFee}
                onChange={(event) => setMaintenanceFee(event.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </div>
          </div>
          {needsOverrideReason ? (
            <div>
              <label htmlFor="agreement-override-reason" className="block text-sm font-medium">Override reason</label>
              <textarea
                id="agreement-override-reason"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                required
              />
            </div>
          ) : null}
        </section>

        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button
            type="submit"
            disabled={
              saving ||
              !selectedPeriod ||
              !selectedRoom ||
              !resolvedRate ||
              agreedMinor == null ||
              !Number.isInteger(agreedMinor) ||
              agreedMinor <= 0 ||
              (needsOverrideReason && !overrideReason.trim())
            }
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Creating…" : "Save Agreement"}
          </button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
