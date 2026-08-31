import { StatusBadge } from "../../components/common/StatusBadge";
import type { AcademicSession, RoomRate } from "../../types/api";
import { formatCurrencyMinor } from "../../utils/format";

export function RoomRatesSection({ rates, sessions, canWrite, onCreate, onStatus }: { rates: RoomRate[]; sessions: AcademicSession[]; canWrite: boolean; onCreate: () => void; onStatus: (rate: RoomRate, status: string) => void }) {
  return (
    <section className="rounded border border-border p-3">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Rates</h3>{canWrite ? <button type="button" onClick={onCreate} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Add Rate</button> : null}</div>
      <p className="mt-1 text-xs text-text-secondary">Rate changes do not alter existing booking totals.</p>
      {!rates.length ? <p className="mt-3 text-sm text-text-secondary">No rates have been created for this room.</p> : (
        <div className="mt-3 overflow-x-auto"><table className="min-w-full divide-y divide-border text-sm"><thead><tr><th className="px-3 py-2 text-left">Rate</th><th className="px-3 py-2 text-left">Session</th><th className="px-3 py-2 text-left">Amount</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Actions</th></tr></thead><tbody className="divide-y divide-border">{rates.map((rate) => <tr key={rate.id}><td className="px-3 py-2">{rate.rate_code}</td><td className="px-3 py-2">{sessions.find((session) => session.id === rate.academic_session_id)?.name ?? `Session #${rate.academic_session_id}`}</td><td className="px-3 py-2">{formatCurrencyMinor(rate.amount_minor, rate.currency)}</td><td className="px-3 py-2"><StatusBadge status={rate.status} /></td><td className="px-3 py-2">{canWrite ? <button type="button" onClick={() => onStatus(rate, rate.status === "active" ? "inactive" : "active")} className="text-sm font-semibold text-primary hover:underline">Mark {rate.status === "active" ? "Inactive" : "Active"}</button> : "No action"}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}
