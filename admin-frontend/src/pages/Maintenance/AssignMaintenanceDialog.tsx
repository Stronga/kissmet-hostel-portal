import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { MaintenanceRequest, Staff } from "../../types/api";
import { staffLabel } from "./maintenanceView";

export function AssignMaintenanceDialog({ open, request, staff, saving, error, onClose, onAssign }: { open: boolean; request: MaintenanceRequest | null; staff: Staff[]; saving: boolean; error: string | null; onClose: () => void; onAssign: (staffId: number) => void }) {
  const [staffId, setStaffId] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (staffId) onAssign(Number(staffId));
  }
  return (
    <ConfirmDialog open={open} title="Assign maintenance request" description="Assignment changes the request to assigned. It does not resolve the issue." onClose={onClose}>
      {request ? <form onSubmit={submit} className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-text-secondary">Request</dt><dd className="font-medium">{request.request_number}</dd></div><div><dt className="text-xs text-text-secondary">Issue</dt><dd className="font-medium">{request.title}</dd></div></dl>
        <label className="block text-sm font-medium">Assigned staff<select aria-label="Assigned maintenance staff" value={staffId} onChange={(event) => setStaffId(event.target.value)} required className="mt-1 w-full rounded-md border border-border px-3 py-2"><option value="">Select staff</option>{staff.map((item) => <option key={item.id} value={item.id}>{staffLabel(item)}</option>)}</select></label>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || !staffId} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Assign Request</button></div>
      </form> : null}
    </ConfirmDialog>
  );
}
