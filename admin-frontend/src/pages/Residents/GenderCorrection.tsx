import { FormEvent, useEffect, useState } from "react";
import { correctResidentGender, listGenderPlacementConflicts } from "../../api/residents";
import type { GenderCorrectionReason, GenderPlacementConflict, Resident, ResidentGenderValue } from "../../types/api";
import { formatStatus } from "../../utils/format";

export const GENDER_OPTIONS: Array<{ value: ResidentGenderValue; label: string }> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "not_specified", label: "Not specified" }
];

export const GENDER_CORRECTION_REASON_OPTIONS: Array<{ value: GenderCorrectionReason; label: string }> = [
  { value: "data_entry_error", label: "Data entry error" },
  { value: "resident_request", label: "Resident request" },
  { value: "identity_document_verified", label: "Verified against identity document" },
  { value: "other", label: "Other" }
];

function conflictLabel(c: GenderPlacementConflict) {
  const what = c.kind === "allocation" ? `Active allocation #${c.allocationId}` : `${formatStatus(c.bookingStatus)} booking ${c.bookingNumber ?? `#${c.bookingId}`}`;
  return `${what} in ${formatStatus(c.roomGenderPolicy)}-only room ${c.roomCode}`;
}

function ConflictList({ conflicts }: { conflicts: GenderPlacementConflict[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {conflicts.map((c) => <li key={`${c.kind}-${c.allocationId ?? c.bookingId}`}>{conflictLabel(c)}</li>)}
    </ul>
  );
}

/**
 * Authorized gender correction (permission resident:gender_correct). If the new value would leave the
 * resident in a single-gender room they are no longer eligible for, the server changes nothing and
 * returns the placements; staff must acknowledge them (they are flagged for transfer, never moved).
 */
export function GenderCorrectionForm({ resident, onCorrected }: { resident: Resident; onCorrected: (resident: Resident, flagged: GenderPlacementConflict[]) => void }) {
  const [gender, setGender] = useState<ResidentGenderValue | "">("");
  const [reasonCode, setReasonCode] = useState<GenderCorrectionReason | "">("");
  const [pending, setPending] = useState<GenderPlacementConflict[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<GenderPlacementConflict[] | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!gender || !reasonCode) {
      setError("Choose the corrected gender and a reason.");
      return;
    }
    if (gender === resident.gender) {
      setError("That gender is already recorded.");
      return;
    }
    setSaving(true);
    try {
      const result = await correctResidentGender(resident.id, { gender, reasonCode, acknowledgeConflicts: pending ? acknowledged : false });
      if (!result.applied) {
        setPending(result.conflicts);
        setAcknowledged(false);
        return;
      }
      setPending(null);
      setDone(result.conflicts);
      onCorrected(result.resident, result.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to correct gender.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Correct gender" className="space-y-3 rounded border border-border p-3">
      <h3 className="text-sm font-semibold">Correct recorded gender</h3>
      <p className="text-xs text-text-secondary">Single-gender rooms only accept residents recorded as the matching gender. Every correction is audited.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Corrected gender
          <select aria-label="Corrected gender" value={gender} onChange={(e) => { setGender(e.target.value as ResidentGenderValue); setPending(null); }} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm">
            <option value="">Select…</option>
            {GENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Reason
          <select aria-label="Correction reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as GenderCorrectionReason)} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm">
            <option value="">Select…</option>
            {GENDER_CORRECTION_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {pending ? (
        <div role="alert" className="space-y-2 rounded border border-warning bg-warning/10 p-3">
          <p className="text-sm font-semibold">This correction would leave the resident in rooms they are no longer eligible for:</p>
          <ConflictList conflicts={pending} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>I understand. Apply the correction and flag these placements for transfer. Nothing is moved automatically.</span>
          </label>
        </div>
      ) : null}
      {done && done.length ? (
        <p role="status" className="text-sm font-medium">Gender corrected. {done.length} placement(s) flagged for transfer; see Gender placement conflicts.</p>
      ) : done ? <p role="status" className="text-sm font-medium">Gender corrected.</p> : null}
      {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
      <button type="submit" disabled={saving || Boolean(pending && !acknowledged)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Apply and flag placements" : "Correct gender"}
      </button>
    </form>
  );
}

/** Live list of placements breaking the single-gender rule (from corrections or legacy data). */
export function GenderConflictsPanel({ refreshKey }: { refreshKey: number }) {
  const [conflicts, setConflicts] = useState<GenderPlacementConflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listGenderPlacementConflicts()
      .then((rows) => { if (!cancelled) { setConflicts(rows); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load gender placement conflicts."); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <section aria-label="Gender placement conflicts" className="rounded-token border border-warning bg-warning/10 p-4">
      <h2 className="text-sm font-semibold">Gender placement conflicts ({conflicts.length})</h2>
      <p className="mb-2 text-xs text-text-secondary">These residents are in single-gender rooms their recorded gender does not allow. Transfer them to an eligible room or end the placement.</p>
      <ConflictList conflicts={conflicts} />
    </section>
  );
}
