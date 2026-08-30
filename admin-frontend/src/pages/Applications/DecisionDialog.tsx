import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { ApplicationStatus } from "../../types/api";
import { formatStatus } from "../../utils/format";

export function DecisionDialog({
  open,
  status,
  pending,
  error,
  onCancel,
  onConfirm
}: {
  open: boolean;
  status: ApplicationStatus | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (notes?: string) => void;
}) {
  const [notes, setNotes] = useState("");
  if (!status) return null;

  const isApproval = status === "approved";
  function submit(event: FormEvent) {
    event.preventDefault();
    onConfirm(notes.trim() || undefined);
  }

  return (
    <ConfirmDialog
      open={open}
      title={isApproval ? "Approve this application?" : `${formatStatus(status)} application`}
      description={isApproval ? "The applicant will become eligible for booking. No room or bed will be allocated automatically." : undefined}
      onClose={onCancel}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="decision-notes" className="block text-sm font-medium text-text-primary">Decision notes</label>
          <textarea
            id="decision-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving..." : "Confirm"}</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
