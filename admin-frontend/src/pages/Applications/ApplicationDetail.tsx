import { ApplicationReviewActions } from "./ApplicationReviewActions";
import { DocumentReviewSection } from "./DocumentReviewSection";
import type React from "react";
import type { AcademicSession, Application, ApplicationStatus, IdentityDocument, Institution, Resident } from "../../types/api";
import { formatDateTime, formatStatus } from "../../utils/format";

function residentName(resident?: Resident) {
  if (!resident) return "Resident record unavailable";
  return [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ") || `Resident #${resident.id}`;
}

function requestedTermLabel(kind?: string | null) {
  if (kind === "calendar_year") return "Calendar Year";
  if (kind === "short_term") return "Short-Term";
  if (kind === "academic_calendar") return "Academic Calendar";
  return "Academic Calendar";
}

function isOther(resident?: Resident) {
  return !resident ? false : resident.institution_id == null || resident.resident_kind === "non_student";
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
  const other = isOther(resident);
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
        ["Resident code", resident?.resident_code],
        ["Institution", other ? "Other" : (institution?.name ?? "Not set")],
        ["Identifier type", other ? "Ghana Card Number" : "Student ID / School Number"],
        ["Identifier", other ? (resident?.ghana_card_number_masked ?? "••••") : (resident?.student_id ?? "Not set")],
        ["Applicant status", resident?.status ? formatStatus(resident.status) : undefined]
      ]} />
      <DetailSection title="Requested term (not the final agreement)" rows={[
        ["Requested Term", requestedTermLabel(application.lease_kind)],
        ["Requested Lease Period ID", application.lease_period_id ?? "Not linked"],
        ["Academic session", application.academic_session_id == null ? "Not applicable for this request" : (session?.name ?? `Session #${application.academic_session_id}`)],
        ["Note", "Requested Term is what the applicant asked for. The approved commercial agreement is created separately by management."]
      ]} />
      <DetailSection title="Review" rows={[
        ["Reviewed by staff ID", application.reviewed_by_staff_id],
        ["Reviewed at", application.reviewed_at ? formatDateTime(application.reviewed_at) : "Not reviewed"],
        ["Decision notes", application.decision_notes]
      ]} />
      <DetailSection title="Documents">
        <DocumentReviewSection documents={documents} />
      </DetailSection>
      <DetailSection title="Approved agreement / booking" rows={[
        ["Eligibility", application.status === "approved" ? "Eligible for booking workflow" : "Not eligible for booking workflow"],
        ["Automation", "Approval does not create a booking, confirm a booking, allocate a bed, or change payments"],
        ["Calendar Year / Short-Term booking", "Final booking still requires an academic session until a later commercial stage. Do not invent a fake session."]
      ]} />
      <DetailSection title="Actions">
        <ApplicationReviewActions application={application} canManage={canManage} pending={pending} onAction={onAction} />
      </DetailSection>
    </div>
  );
}
