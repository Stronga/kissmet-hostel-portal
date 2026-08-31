import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

export function NoteActionDialog({ open, title, description, label, saving, error, onSubmit, onClose }: { open: boolean; title: string; description: string; label: string; saving: boolean; error: string | null; onSubmit: (notes?: string) => void; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(notes.trim() || undefined);
  }
  return (
    <ConfirmDialog open={open} title={title} description={description} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">{label}<textarea aria-label={label} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button></div>
      </form>
    </ConfirmDialog>
  );
}
