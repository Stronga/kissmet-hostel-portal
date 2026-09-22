import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

const statuses = ["active", "inactive", "archived"] as const;

export function InstitutionFormDialog({
  open,
  saving,
  error,
  onClose,
  onCreate
}: {
  open: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: { code: string; name: string; status: string }) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCode("");
      setName("");
      setStatus("active");
      setLocalError(null);
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!code.trim() || !name.trim()) {
      setLocalError("Institution code and name are required.");
      return;
    }
    onCreate({ code: code.trim(), name: name.trim(), status });
  }

  return (
    <ConfirmDialog open={open} title="Create Institution" description="Institutions are used when registering residents and applications." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Institution Code<input aria-label="Institution Code" value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Institution Name<input aria-label="Institution Name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Status<select aria-label="Institution status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">{statuses.map((item) => <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>)}</select></label>
        </div>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create Institution"}</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
