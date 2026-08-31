import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

export function BedFormDialog({ open, saving, error, disabledReason, onClose, onCreate }: { open: boolean; saving: boolean; error: string | null; disabledReason?: string | null; onClose: () => void; onCreate: (input: { bedCode: string; label: string; status: string }) => void }) {
  const [bedCode, setBedCode] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("available");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!bedCode.trim() || !label.trim()) return;
    onCreate({ bedCode: bedCode.trim(), label: label.trim(), status });
  }
  return (
    <ConfirmDialog open={open} title="Create Bed" description="Beds are the authoritative usable inventory for occupancy." onClose={onClose}>
      {disabledReason ? <p role="alert" className="mb-3 text-sm font-medium text-danger">{disabledReason}</p> : null}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Bed code<input aria-label="Bed code" value={bedCode} onChange={(event) => setBedCode(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Label<input aria-label="Bed label" value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Status<select aria-label="Bed status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="available">Available</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
        </div>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving || Boolean(disabledReason)} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Bed</button></div>
      </form>
    </ConfirmDialog>
  );
}
