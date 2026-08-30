import { ApplicationReviewActions } from "./ApplicationReviewActions";
import { DocumentReviewSection } from "./DocumentReviewSection";
import type React from "react";
import type { AcademicSession, Application, ApplicationStatus, IdentityDocument, Institution, Resident } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

function residentName(resident?: Resident) {
  if (!resident) return "Resident record unavailable";
  return [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ") || `Resident #${resident.id}`;
}

function DetailSection({ title, rows, children }: { title: string; rows?: [string, string | number | null | undefined][]; children?: React.ReactNode }) {
  return (
    <section className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {rows ? (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-secondary">{label}</dt>
              <dd className="font-medium text-text-primary">{value || "Not available"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

export function ApplicationDetail({
  application,
  resident,
  institution,
  session,
  documents,
  canManage,
  pending,
  onAction
}: {
  application: Application;
  resident?: Resident;
  institution?: Institution;
  session?: AcademicSession;
  documents: IdentityDocument[];
  canManage: boolean;
  pending: boolean;
  onAction: (status: ApplicationStatus) => void;
}) {
  return (
    <div className="space-y-3">
      <DetailSection title="Application" rows={[
        ["Application number", application.application_number],
        ["Status", formatStatus(application.status)],
        ["Created", formatDateTime(application.created_at)],
        ["Submitted", application.submitted_at ? formatDateTime(application.submitted_at) : "Not submitted"],
        ["Updated", formatDateTime(application.updated_at)]
      ]} />
      <DetailSection title="Applicant" rows={[
        ["Name", residentName(resident)],
        ["Student ID", resident?.student_id],
        ["Resident code", resident?.resident_code],
        ["Applicant status", resident?.status ? formatStatus(resident.status) : undefined]
      ]} />
      <DetailSection title="Review" rows={[
        ["Academic session", session?.name ?? `Session #${application.academic_session_id}`],
        ["Institution", institution?.name],
        ["Reviewed by staff ID", application.reviewed_by_staff_id],
        ["Reviewed at", application.reviewed_at ? formatDateTime(application.reviewed_at) : "Not reviewed"],
        ["Decision notes", application.decision_notes]
      ]} />
      <DetailSection title="Documents">
        <DocumentReviewSection documents={documents} />
      </DetailSection>
      <DetailSection title="Booking" rows={[
        ["Eligibility", application.status === "approved" ? "Eligible for booking workflow" : "Not eligible for booking workflow"],
        ["Automation", "Approval does not create a booking, confirm a booking, allocate a bed, or change payments"]
      ]} />
      <DetailSection title="Actions">
        <ApplicationReviewActions application={application} canManage={canManage} pending={pending} onAction={onAction} />
      </DetailSection>
    </div>
  );
}
