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
  document_type: string;
  status: string;
  original_filename?: string | null;
  created_at?: string | null;
}

export interface ResidentApplication {
  id: number;
  application_number: string;
  academic_session_id: number;
  status: ApplicationStatus;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  decision_notes?: string | null;
}

export interface ResidentBooking {
  id: number;
  booking_number: string;
  academic_session_id: number;
  status: BookingStatus;
  total_amount_minor: number;
  currency: string;
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
