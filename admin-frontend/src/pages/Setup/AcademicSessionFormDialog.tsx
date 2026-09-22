import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

const statuses = ["draft", "active", "closed", "archived"] as const;

export function AcademicSessionFormDialog({
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
  onCreate: (input: { code: string; name: string; startsOn: string; endsOn: string; status: string }) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCode("");
      setName("");
      setStartsOn("");
      setEndsOn("");
      setStatus("draft");
      setLocalError(null);
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!code.trim() || !name.trim() || !startsOn || !endsOn) {
      setLocalError("Session code, name, start date and end date are required.");
      return;
    }
    if (startsOn > endsOn) {
      setLocalError("Start date must be on or before the end date.");
      return;
    }
    onCreate({ code: code.trim(), name: name.trim(), startsOn, endsOn, status });
  }

  return (
    <ConfirmDialog open={open} title="Create Academic Session" description="Academic sessions define the booking and allocation period. Activating a session closes any other active session." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Session Code<input aria-label="Session Code" value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Session Name<input aria-label="Session Name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Start Date<input aria-label="Start Date" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">End Date<input aria-label="End Date" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" /></label>
          <label className="text-sm font-medium">Status<select aria-label="Session status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2">{statuses.map((item) => <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>)}</select></label>
        </div>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create Session"}</button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
