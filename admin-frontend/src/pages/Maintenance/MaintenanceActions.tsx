import type { MaintenanceRequest } from "../../types/api";
import { canAssign, canCancel, canClose, canResolve, canStart } from "./maintenanceView";

export function MaintenanceActions({ request, permissions, saving, onAssign, onStart, onResolve, onClose, onCancel }: { request: MaintenanceRequest; permissions: { assign: boolean; update: boolean; resolve: boolean; close: boolean }; saving: boolean; onAssign: () => void; onStart: () => void; onResolve: () => void; onClose: () => void; onCancel: () => void }) {
  const hasAny = permissions.assign || permissions.update || permissions.resolve || permissions.close;
  if (!hasAny) return <p className="text-sm text-text-secondary">No maintenance management permission.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {permissions.assign && canAssign(request) ? <button type="button" disabled={saving} onClick={onAssign} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Assign</button> : null}
      {permissions.update && canStart(request) ? <button type="button" disabled={saving} onClick={onStart} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Start Work</button> : null}
      {permissions.resolve && canResolve(request) ? <button type="button" disabled={saving} onClick={onResolve} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Resolve</button> : null}
      {permissions.close && canClose(request) ? <button type="button" disabled={saving} onClick={onClose} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Close</button> : null}
      {permissions.update && canCancel(request) ? <button type="button" disabled={saving} onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Cancel</button> : null}
    </div>
  );
}
