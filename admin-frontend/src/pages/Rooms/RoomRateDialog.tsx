import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { AcademicSession } from "../../types/api";
import { parseMoneyToMinorUnits } from "../../utils/money";

export function RoomRateDialog({ open, sessions, saving, error, onClose, onCreate }: { open: boolean; sessions: AcademicSession[]; saving: boolean; error: string | null; onClose: () => void; onCreate: (input: { academicSessionId: number; rateCode: string; amountMinor: number; currency: string; status: string }) => void }) {
  const active = sessions.find((session) => session.status === "active") ?? sessions[0];
  const [sessionId, setSessionId] = useState(active ? String(active.id) : "");
  const [rateCode, setRateCode] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [status, setStatus] = useState("active");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (open && active && !sessionId) setSessionId(String(active.id));
  }, [active, open, sessionId]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    try {
      if (!sessionId || !rateCode.trim()) throw new Error("Academic session and rate code are required.");
      onCreate({ academicSessionId: Number(sessionId), rateCode: rateCode.trim(), amountMinor: parseMoneyToMinorUnits(amount), currency, status });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Invalid room rate.");
    }
  }
  return (
    <ConfirmDialog open={open} title="Create Room Rate" description="Rate changes do not alter existing booking totals." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Academic session<select aria-label="Academic session" value={sessionId} onChange={(event) => setSessionId(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>
          <label className="text-sm font-medium">Rate code<input aria-label="Rate code" value={rateCode} onChange={(event) => setRateCode(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Amount<input aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="2500.00" className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Currency<input aria-label="Currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Status<select aria-label="Rate status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
        </div>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Rate</button></div>
      </form>
    </ConfirmDialog>
  );
}
