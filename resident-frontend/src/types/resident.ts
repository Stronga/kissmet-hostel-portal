export type ResidentStatus = "prospect" | "applicant" | "resident" | "past_resident" | "suspended" | "archived";
export type ApplicationStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "cancelled" | "archived";
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "completed" | "archived";

export interface ResidentProfile {
  id: number;
  resident_code: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  status: ResidentStatus;
  phone_verified_at?: string | null;
  phone?: string | null;
  email?: string | null;
  institution_code?: string | null;
  institution_name?: string | null;
  student_id?: string | null;
}

export interface ResidentDocument {
  id: number;
  document_type: "student_card" | "ghana_card" | string;
  status: "uploaded" | "verified" | "rejected" | string;
  original_filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
  rejection_reason?: string | null;
}

export interface ResidentApplication {
  id: number;
  application_number: string;
  academic_session_id: number;
  status: ApplicationStatus;
  created_at?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  decision_notes?: string | null;
}

export interface AcademicSession {
  id: number;
  code: string;
  name: string;
  starts_on?: string | null;
  ends_on?: string | null;
  status: string;
}

export interface ResidentBooking {
  id: number;
  booking_number: string;
  academic_session_id: number;
  application_id?: number | null;
  status: BookingStatus;
  total_amount_minor: number;
  currency: string;
  booked_at?: string | null;
  expires_at?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  payment_attention_required?: number | boolean | null;
  payment_attention_reason?: string | null;
  academic_session_code?: string | null;
  academic_session_name?: string | null;
  application_number?: string | null;
  priced_room_code?: string | null;
  priced_room_name?: string | null;
}

export interface ResidentAllocation {
  id: number;
  bed_id: number;
  status: string;
  starts_on?: string | null;
  room_code: string;
  room_name?: string | null;
  bed_code: string;
  label?: string | null;
  academic_session_id: number;
}

export interface DashboardData {
  profile: ResidentProfile;
  documents: ResidentDocument[];
  applications: ResidentApplication[];
  bookings: ResidentBooking[];
  allocation: ResidentAllocation | null;
  partialErrors: string[];
}
