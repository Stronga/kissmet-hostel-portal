import type { Booking, BookingAgreementFinancial, Room, RoomRate } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

function leaseBadge(kind?: string | null) {
  if (kind === "calendar_year") return "CALENDAR YEAR";
  if (kind === "short_term") return "SHORT-TERM";
  if (kind === "academic_calendar") return "ACADEMIC CALENDAR";
  return null;
}

export function BookingFinancialSummary({
  booking,
  room,
  rate,
  financial,
  leasePeriodName,
  requestedLeaseKind,
  canManagePaymentPolicy,
  onEditPaymentPolicy
}: {
  booking: Booking;
  room?: Room;
  rate?: RoomRate;
  financial?: BookingAgreementFinancial | null;
  leasePeriodName?: string | null;
  requestedLeaseKind?: string | null;
  canManagePaymentPolicy?: boolean;
  onEditPaymentPolicy?: () => void;
}) {
  const badge = leaseBadge(booking.lease_kind);
  const isLegacy = booking.lease_period_id == null && booking.priced_room_rate_id != null;
  const currency = financial?.currency ?? booking.currency;
  const accommodation = financial?.agreed_accommodation_amount_minor ?? booking.total_amount_minor;
  const maintenance = financial?.maintenance_fee_minor ?? booking.maintenance_fee_minor ?? null;
  const obligation = financial?.total_obligation_minor ?? (accommodation + (maintenance ?? 0));
  const verified = financial?.verified_paid_minor;
  const balance = financial?.balance_minor;

  return (
    <section className="rounded border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Agreement / financial basis</h3>
        {badge ? <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-bold tracking-wide text-text-primary">{badge}</span> : null}
        {isLegacy ? <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-bold tracking-wide text-text-secondary">LEGACY</span> : null}
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {requestedLeaseKind ? (
          <div>
            <dt className="text-xs text-text-secondary">Requested Term</dt>
            <dd className="font-medium">{leaseBadge(requestedLeaseKind)?.replace(/_/g, " ") ?? requestedLeaseKind}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-text-secondary">Approved Term</dt>
          <dd className="font-medium">{badge ?? (isLegacy ? "Legacy academic / room rate" : "Not set")}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Approved Lease Period</dt>
          <dd className="font-medium">{leasePeriodName ?? (booking.lease_period_id ? `#${booking.lease_period_id}` : "Not linked")}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Agreement dates</dt>
          <dd className="font-medium">
            {booking.starts_on || booking.ends_on
              ? `${booking.starts_on ?? "—"} → ${booking.ends_on ?? "—"}`
              : "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Priced room</dt>
          <dd className="font-medium">{room ? `${room.room_code}${room.room_name ? ` - ${room.room_name}` : ""} (capacity ${room.capacity})` : `Room #${booking.priced_room_id ?? "unknown"}`}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Rate source</dt>
          <dd className="font-medium">
            {booking.lease_period_id != null
              ? "Lease rate card (snapshot)"
              : (rate?.rate_code ?? `Rate #${booking.priced_room_rate_id ?? "unknown"}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Agreed Accommodation</dt>
          <dd className="font-medium">{formatCurrencyMinor(accommodation, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Maintenance Fee</dt>
          <dd className="font-medium">{maintenance == null ? "Not set" : formatCurrencyMinor(maintenance, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Total Obligation</dt>
          <dd className="font-medium">{formatCurrencyMinor(obligation, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Verified Paid</dt>
          <dd className="font-medium">{verified == null ? "See payment summary" : formatCurrencyMinor(verified, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Balance</dt>
          <dd className="font-medium">{balance == null ? "See payment summary" : formatCurrencyMinor(balance, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Currency</dt>
          <dd className="font-medium">{currency}</dd>
        </div>
      </dl>
      <div className="mt-3 rounded border border-border bg-muted/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs text-text-secondary">Payment Requirement</p>
            <p className="font-semibold text-text-primary">
              {Number(booking.partial_payment_authorized) === 1 ? "Partial Payment Authorized" : "Full Payment"}
            </p>
            {Number(booking.partial_payment_authorized) === 1 ? (
              <p className="mt-1 text-sm text-text-secondary">
                {booking.payment_requirement_type === "fixed" && booking.payment_fixed_amount_minor != null
                  ? `Approved minimum initial amount: ${formatCurrencyMinor(booking.payment_fixed_amount_minor, currency)}`
                  : booking.payment_requirement_type === "percentage" && booking.payment_percentage_basis_points != null
                    ? `Approved minimum initial share: ${(Number(booking.payment_percentage_basis_points) / 100).toFixed(2)}%`
                    : "Management-authorized partial arrangement"}
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-secondary">Resident must pay the full outstanding obligation unless management authorizes a partial arrangement.</p>
            )}
          </div>
          {canManagePaymentPolicy && onEditPaymentPolicy ? (
            <button type="button" onClick={onEditPaymentPolicy} className="rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold">
              Payment Policy
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        Captured agreement amounts are shown from the booking snapshot. Future rate-card edits do not rewrite agreed accommodation.
        Verified Paid counts only payments with status verified.
      </p>
    </section>
  );
}
