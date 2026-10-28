import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import type { AcademicSession, LeaseKind, LeasePeriod } from "../../types/api";
import { LEASE_KIND_OPTIONS } from "./setupLabels";

const statuses = ["draft", "active", "closed", "archived"] as const;

export type LeasePeriodCreateInput = {
  kind: LeaseKind;
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: string;
  academicSessionId?: number | null;
  notes?: string | null;
};

export type LeasePeriodUpdateInput = {
  name: string;
  startsOn: string;
  endsOn: string;
  academicSessionId?: number | null;
  notes?: string | null;
};

export function LeasePeriodFormDialog({
  open,
  mode,
  initial,
  sessions,
  saving,
  error,
  onClose,
  onCreate,
  onUpdate
}: {
  open: boolean;
  mode: "create" | "edit";
  initial?: LeasePeriod | null;
  sessions: AcademicSession[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: LeasePeriodCreateInput) => void;
  onUpdate: (input: LeasePeriodUpdateInput) => void;
}) {
  const [kind, setKind] = useState<LeaseKind>("academic_calendar");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [status, setStatus] = useState("draft");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setKind("academic_calendar");
      setCode("");
      setName("");
      setStartsOn("");
      setEndsOn("");
      setStatus("draft");
      setAcademicSessionId("");
      setNotes("");
      setLocalError(null);
      return;
    }
    if (mode === "edit" && initial) {
      setKind(initial.kind as LeaseKind);
      setCode(initial.code);
      setName(initial.name);
      setStartsOn(initial.starts_on);
      setEndsOn(initial.ends_on);
      setStatus(String(initial.status));
      setAcademicSessionId(initial.academic_session_id == null ? "" : String(initial.academic_session_id));
      setNotes(initial.notes ?? "");
      setLocalError(null);
    }
  }, [open, mode, initial]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (mode === "create" && (!code.trim() || !name.trim() || !startsOn || !endsOn)) {
      setLocalError("Code, name, start date and end date are required.");
      return;
    }
    if (mode === "edit" && (!name.trim() || !startsOn || !endsOn)) {
      setLocalError("Name, start date and end date are required.");
      return;
    }
    if (startsOn > endsOn) {
      setLocalError("Start date must be on or before the end date.");
      return;
    }
    const sessionId = kind === "academic_calendar" && academicSessionId
      ? Number(academicSessionId)
      : null;
    if (mode === "create") {
      onCreate({
        kind,
        code: code.trim(),
        name: name.trim(),
        startsOn,
        endsOn,
        status,
        academicSessionId: sessionId,
        notes: notes.trim() || null
      });
      return;
    }
    onUpdate({
      name: name.trim(),
      startsOn,
      endsOn,
      academicSessionId: kind === "academic_calendar" ? sessionId : null,
      notes: notes.trim() || null
    });
  }

  const title = mode === "create" ? "Create Lease Period" : "Edit Lease Period";
  const description = "A lease period is Kissmet's accommodation contract window. It is separate from an Academic Session, which organizes school calendars.";

  return (
    <ConfirmDialog open={open} title={title} description={description} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Lease Type
            <select
              aria-label="Lease Type"
              value={kind}
              disabled={mode === "edit"}
              onChange={(event) => {
                const next = event.target.value as LeaseKind;
                setKind(next);
                if (next !== "academic_calendar") setAcademicSessionId("");
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 disabled:bg-muted"
            >
              {LEASE_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Code
            <input
              aria-label="Lease Period Code"
              value={code}
              disabled={mode === "edit"}
              onChange={(event) => setCode(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 disabled:bg-muted"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Name
            <input
              aria-label="Lease Period Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Start Date
            <input
              aria-label="Lease Period Start Date"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            End Date
            <input
              aria-label="Lease Period End Date"
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          {kind === "academic_calendar" ? (
            <label className="text-sm font-medium sm:col-span-2">
              Academic Session (optional)
              <select
                aria-label="Academic Session"
                value={academicSessionId}
                onChange={(event) => setAcademicSessionId(event.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              >
                <option value="">No linked session</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name} ({session.code})
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-text-secondary">
                Link only when this Academic Calendar period corresponds to a school session. Calendar Year and Short-Term periods do not use sessions.
              </span>
            </label>
          ) : (
            <p className="sm:col-span-2 text-xs text-text-secondary">
              {kind === "calendar_year"
                ? "Calendar Year periods do not require an Academic Session."
                : "Short-Term periods do not require an Academic Session."}
            </p>
          )}
          {mode === "create" ? (
            <label className="text-sm font-medium">
              Status
              <select
                aria-label="Lease Period status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              >
                {statuses.map((item) => (
                  <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className={`text-sm font-medium ${mode === "create" ? "" : "sm:col-span-2"}`}>
            Notes
            <input
              aria-label="Lease Period Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
        </div>
        {localError || error ? <p role="alert" className="text-sm font-medium text-danger">{localError || error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Saving..." : mode === "create" ? "Create Lease Period" : "Save Changes"}
          </button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
