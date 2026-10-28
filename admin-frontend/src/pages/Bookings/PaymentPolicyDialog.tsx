import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { formatCurrencyMinor } from "../../utils/format";
import { parseMoneyToMinorUnits } from "../../utils/money";

type RequirementType = "full" | "fixed" | "percentage";

export function PaymentPolicyDialog({
  open,
  currency,
  obligationMinor,
  initialAuthorized,
  initialType,
  initialFixedMinor,
  initialPercentageBps,
  saving,
  error,
  onClose,
  onSave
}: {
  open: boolean;
  currency: string;
  obligationMinor: number;
  initialAuthorized: boolean;
  initialType: RequirementType | string | null;
  initialFixedMinor: number | null;
  initialPercentageBps: number | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: {
    partialPaymentAuthorized: boolean;
    paymentRequirementType?: string | null;
    paymentFixedAmountMinor?: number | null;
    paymentPercentageBasisPoints?: number | null;
    reason: string;
  }) => void;
}) {
  const [mode, setMode] = useState<"full" | "partial">(initialAuthorized ? "partial" : "full");
  const [type, setType] = useState<RequirementType>(
    initialType === "fixed" || initialType === "percentage" ? initialType : "fixed"
  );
  const [fixedMajor, setFixedMajor] = useState(
    initialFixedMinor != null ? String(Number(initialFixedMinor) / 100) : ""
  );
  const [percentage, setPercentage] = useState(
    initialPercentageBps != null ? String(Number(initialPercentageBps) / 100) : ""
  );
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialAuthorized ? "partial" : "full");
    setType(initialType === "fixed" || initialType === "percentage" ? initialType : "fixed");
    setFixedMajor(initialFixedMinor != null ? String(Number(initialFixedMinor) / 100) : "");
    setPercentage(initialPercentageBps != null ? String(Number(initialPercentageBps) / 100) : "");
    setReason("");
    setFormError(null);
  }, [open, initialAuthorized, initialType, initialFixedMinor, initialPercentageBps]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!reason.trim()) {
      setFormError("A management reason is required.");
      return;
    }
    if (mode === "full") {
      onSave({ partialPaymentAuthorized: false, reason: reason.trim() });
      return;
    }
    if (type === "fixed") {
      let minor: number;
      try {
        minor = parseMoneyToMinorUnits(fixedMajor);
      } catch {
        setFormError("Enter a valid minimum initial amount.");
        return;
      }
      if (minor <= 0) {
        setFormError("Enter a valid minimum initial amount.");
        return;
      }
      if (minor > obligationMinor) {
        setFormError("Minimum amount cannot exceed the agreement obligation.");
        return;
      }
      onSave({
        partialPaymentAuthorized: true,
        paymentRequirementType: "fixed",
        paymentFixedAmountMinor: minor,
        reason: reason.trim()
      });
      return;
    }
    const pct = Number(percentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setFormError("Enter a percentage between 0 and 100.");
      return;
    }
    onSave({
      partialPaymentAuthorized: true,
      paymentRequirementType: "percentage",
      paymentPercentageBasisPoints: Math.round(pct * 100),
      reason: reason.trim()
    });
  }

  return (
    <ConfirmDialog open={open} title="Agreement Payment Policy" onClose={() => { if (!saving) onClose(); }}>
      <p className="text-sm text-text-secondary">
        Full payment is the default. Partial payment is authorized per agreement by management only.
        This does not change the agreed accommodation price. Obligation: {formatCurrencyMinor(obligationMinor, currency)}.
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Payment requirement</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="policy-mode" checked={mode === "full"} onChange={() => setMode("full")} disabled={saving} />
            Full Payment
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="policy-mode" checked={mode === "partial"} onChange={() => setMode("partial")} disabled={saving} />
            Partial Payment Authorized
          </label>
        </fieldset>
        {mode === "partial" ? (
          <div className="space-y-3 rounded border border-border p-3">
            <div>
              <label htmlFor="policy-type" className="block text-sm font-medium">Arrangement type</label>
              <select id="policy-type" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value as RequirementType)} disabled={saving}>
                <option value="fixed">Minimum initial amount</option>
                <option value="percentage">Minimum initial percentage</option>
              </select>
            </div>
            {type === "fixed" ? (
              <div>
                <label htmlFor="policy-fixed" className="block text-sm font-medium">Minimum initial amount ({currency})</label>
                <input id="policy-fixed" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={fixedMajor} onChange={(e) => setFixedMajor(e.target.value)} disabled={saving} inputMode="decimal" />
              </div>
            ) : (
              <div>
                <label htmlFor="policy-pct" className="block text-sm font-medium">Minimum initial percentage</label>
                <input id="policy-pct" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" value={percentage} onChange={(e) => setPercentage(e.target.value)} disabled={saving} inputMode="decimal" />
              </div>
            )}
          </div>
        ) : null}
        <div>
          <label htmlFor="policy-reason" className="block text-sm font-medium">Management reason</label>
          <textarea id="policy-reason" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} />
        </div>
        {formError || error ? <p role="alert" className="text-sm font-medium text-danger">{formError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save Payment Policy"}</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
