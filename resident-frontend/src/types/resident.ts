export type ResidentStatus = "prospect" | "applicant" | "resident" | "past_resident" | "suspended" | "archived";
export type ApplicationStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "cancelled" | "archived";
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "completed" | "archived";
export type PaymentStatus = "pending" | "submitted" | "verified" | "rejected" | "refunded" | "cancelled" | "archived";
export type ReceiptStatus = "issued" | "voided" | "archived";
export type MaintenanceStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed" | "cancelled" | "archived";
export type MaintenanceCategory = "plumbing" | "electrical" | "furniture" | "cleaning" | "security" | "other";
export type MaintenancePriority = "low" | "normal" | "high" | "urgent";
export type AnnouncementSeverity = "info" | "warning" | "critical" | "high_alert" | string;
export type PortalMessageStatus = "unread" | "read";

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

export interface ResidentPayment {
  id: number;
  booking_id: number;
  payment_reference: string;
  status: PaymentStatus;
  amount_minor: number;
  currency: string;
  method: "cash" | "bank_transfer" | "mobile_money" | "card" | "other";
  paid_at?: string | null;
  submitted_at?: string | null;
  verified_at?: string | null;
  created_at?: string | null;
  booking_number?: string | null;
  slip_document_id?: number | null;
  slip_filename?: string | null;
  slip_content_type?: string | null;
  slip_size_bytes?: number | null;
}

export interface ResidentPaymentSummary {
  bookingId: number;
  bookingNumber: string;
  bookingStatus: BookingStatus;
  bookingTotalMinor: number;
  verifiedTotalMinor: number;
  outstandingMinor: number;
  submittedTotalMinor: number;
  pendingTotalMinor: number;
  refundedTotalMinor: number;
  requiredConfirmationAmountMinor: number;
  remainingToConfirmationMinor: number;
  confirmationRequirementMet: boolean;
  currency: string;
  paymentAttentionRequired: boolean;
  paymentAttentionReason?: string | null;
}

export interface ResidentReceipt {
  id: number;
  receipt_number: string;
  status: ReceiptStatus;
  issued_at?: string | null;
  voided_at?: string | null;
  payment_reference: string;
  amount_minor: number;
  currency: string;
  method: string;
  verified_at?: string | null;
}

export interface ResidentAllocation {
  id: number;
  status: string;
  starts_on?: string | null;
  ends_on?: string | null;
  assigned_at?: string | null;
  released_at?: string | null;
  room_code: string;
  room_name?: string | null;
  room_gender_policy?: "female" | "male" | "any" | string | null;
  room_status?: string | null;
  bed_code: string;
  label?: string | null;
  academic_session_code?: string | null;
  academic_session_name?: string | null;
  booking_number?: string | null;
}

export interface ResidentMaintenanceRequest {
  id: number;
  request_number: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  title: string;
  description?: string | null;
  opened_at?: string | null;
  assigned_at?: string | null;
  started_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  room_code?: string | null;
  room_name?: string | null;
  bed_code?: string | null;
  bed_label?: string | null;
}

export interface ResidentAnnouncement {
  id: number;
  title: string;
  body?: string | null;
  audience?: "all" | "residents" | string | null;
  severity?: AnnouncementSeverity | null;
  published_at?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
}

export interface ResidentMessage {
  id: number;
  subject: string;
  body: string;
  status: PortalMessageStatus;
  delivered_at?: string | null;
  read_at?: string | null;
  sent_at?: string | null;
  message_status?: "sent" | "partially_failed" | "delivered" | string | null;
  sender_label?: string | null;
}

export interface DashboardData {
  profile: ResidentProfile;
  documents: ResidentDocument[];
  applications: ResidentApplication[];
  bookings: ResidentBooking[];
  allocation: ResidentAllocation | null;
  paymentSummary: ResidentPaymentSummary | null;
  announcements: ResidentAnnouncement[];
  messages: ResidentMessage[];
  partialErrors: string[];
}
