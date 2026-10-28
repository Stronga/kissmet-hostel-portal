import type { ResidentApplication, ResidentDocument, ResidentProfile } from "../types/resident";
import { isDocumentUploaded, latestIdentityDocuments } from "./documents";
import { statusLabel } from "./format";

export interface ReadinessItem {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
}

export function latestApplication(applications: ResidentApplication[]) {
  return [...applications].sort((a, b) => b.id - a.id)[0] ?? null;
}

export function applicationStatusLabel(status?: string | null) {
  return statusLabel(status);
}

export function applicationStatusDescription(application?: ResidentApplication | null) {
  if (!application) return "Start a hostel application for the active academic session.";
  if (application.status === "draft") return "Review your readiness checklist and submit when everything is complete.";
  if (application.status === "submitted") return "Your application has been submitted and is waiting for review.";
  if (application.status === "under_review") return "Kissmet staff are reviewing your application.";
  if (application.status === "approved") return "Your application has been approved. You are eligible for booking — this does not assign a room or complete payment.";
  if (application.status === "rejected") return "Your application was not approved.";
  if (application.status === "archived") return "This application is archived.";
  if (application.status === "cancelled") return "This application was cancelled.";
  return "Your application status is available.";
}

export function isStudentResident(profile: ResidentProfile) {
  return (profile.resident_kind ?? "student") !== "non_student";
}

export function buildReadiness(profile: ResidentProfile, documents: ResidentDocument[]): ReadinessItem[] {
  const docs = latestIdentityDocuments(documents);
  const student = isStudentResident(profile);
  const items: ReadinessItem[] = [
    {
      key: "phone",
      label: "Phone verified",
      ready: Boolean(profile.phone_verified_at),
      detail: profile.phone_verified_at ? "Phone verification is complete." : "Verify your phone number before submitting."
    },
    {
      key: "profile",
      label: "Profile complete",
      ready: student
        ? Boolean(profile.first_name && profile.last_name && profile.institution_code && profile.student_id)
        : Boolean(profile.first_name && profile.last_name),
      detail: student
        ? (profile.first_name && profile.last_name && profile.institution_code && profile.student_id ? "Name, institution, and student ID are present." : "Name, institution, and student ID are required.")
        : (profile.first_name && profile.last_name ? "Name is present." : "Name is required.")
    }
  ];
  if (student) {
    items.push({
      key: "student_card",
      label: "Student Card uploaded",
      ready: isDocumentUploaded(docs.student_card),
      detail: isDocumentUploaded(docs.student_card) ? "Student Card has been uploaded." : "Upload your Student Card."
    });
  }
  items.push({
    key: "ghana_card",
    label: "Ghana Card uploaded",
    ready: isDocumentUploaded(docs.ghana_card),
    detail: isDocumentUploaded(docs.ghana_card) ? "Ghana Card has been uploaded." : "Upload your Ghana Card."
  });
  return items;
}

export function isReadyToSubmit(profile: ResidentProfile, documents: ResidentDocument[]) {
  return buildReadiness(profile, documents).every((item) => item.ready);
}
