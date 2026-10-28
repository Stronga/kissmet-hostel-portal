import { DataTable } from "../../components/common/DataTable";
import { StatusBadge } from "../../components/common/StatusBadge";
import type { AcademicSession, Application, Institution, Resident } from "../../types/api";
import { formatDateTime } from "../../utils/format";

function residentName(resident?: Resident) {
  if (!resident) return "Resident record loading";
  return [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ") || `Resident #${resident.id}`;
}

function sessionName(sessions: AcademicSession[], id: number | null | undefined) {
  if (id == null) return "—";
  return sessions.find((session) => session.id === id)?.name ?? `Session #${id}`;
}

function institutionName(institutions: Institution[], resident?: Resident) {
  if (!resident) return "Not set";
  if (resident.institution_id == null || resident.resident_kind === "non_student") return "Other";
  return institutions.find((institution) => institution.id === resident.institution_id)?.name ?? `Institution #${resident.institution_id}`;
}

function requestedTermLabel(kind?: string | null) {
  if (kind === "calendar_year") return "Calendar Year";
  if (kind === "short_term") return "Short-Term";
  if (kind === "academic_calendar") return "Academic Calendar";
  return "Academic Calendar";
}

function identifierDisplay(resident?: Resident) {
  if (!resident) return "—";
  if (resident.institution_id == null || resident.resident_kind === "non_student") {
    return resident.ghana_card_number_masked ?? (resident.has_ghana_card_number ? "••••" : "—");
  }
  return resident.student_id ?? "Not set";
}

export function ApplicationTable({
  applications,
  residentsById,
  institutions,
  sessions,
  onView
}: {
  applications: Application[];
  residentsById: Map<number, Resident>;
  institutions: Institution[];
  sessions: AcademicSession[];
  onView: (application: Application) => void;
}) {
  return (
    <DataTable<Application>
      rows={applications}
      emptyMessage="No applications match the current criteria."
      columns={[
        { key: "number", header: "Application Number", render: (application) => application.application_number },
        { key: "resident", header: "Resident", render: (application) => residentName(residentsById.get(application.resident_id)) },
        { key: "institution", header: "Institution", render: (application) => institutionName(institutions, residentsById.get(application.resident_id)) },
        { key: "identifier", header: "Identifier", render: (application) => identifierDisplay(residentsById.get(application.resident_id)) },
        { key: "term", header: "Requested Term", render: (application) => requestedTermLabel(application.lease_kind) },
        { key: "session", header: "Academic Session", render: (application) => sessionName(sessions, application.academic_session_id) },
        { key: "status", header: "Status", render: (application) => <StatusBadge status={application.status} /> },
        { key: "submitted", header: "Submitted", render: (application) => application.submitted_at ? formatDateTime(application.submitted_at) : "Not submitted" },
        { key: "actions", header: "Actions", render: (application) => <button type="button" onClick={() => onView(application)} className="text-sm font-semibold text-primary hover:underline">View</button> }
      ]}
    />
  );
}
