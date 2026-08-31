export type RoleCode = "super_admin" | "manager" | "reception" | "accounts" | "maintenance" | "resident";

export interface AuthUser {
  id: number;
  userType: "staff" | "resident" | "system";
  displayName: string;
  email: string | null;
  role: RoleCode;
  staffId: number | null;
  residentId: number | null;
  sessionId: number;
}

export interface DashboardOverview {
  total_residents?: number;
  applicants?: number;
  active_residents?: number;
  total_rooms?: number;
  total_active_beds?: number;
  occupied_beds?: number;
  available_beds?: number;
  occupancy_percentage?: number;
  pending_applications?: number;
  under_review_applications?: number;
  approved_applications?: number;
  pending_bookings?: number;
  confirmed_bookings?: number;
  open_maintenance_requests?: number;
  urgent_maintenance_requests?: number;
  published_announcements?: number;
  active_academic_session?: string | null;
  active_staff_count?: number;
}

export interface OccupancyRoom {
  room_code: string;
  configured_capacity: number;
  active_bed_count: number;
  occupied_bed_count: number;
  gender_policy: string;
  room_status: string;
  active_rate_minor: number | null;
}

export interface OccupancyReport {
  total_usable_beds?: number;
  occupied_beds?: number;
  available_beds?: number;
  occupancy_percentage?: number;
  rooms?: OccupancyRoom[];
}

export interface FinancialReport {
  expected_booking_revenue?: number;
  verified_payments?: number;
  outstanding_booking_balances?: number;
  pending_submitted_payment_totals?: number;
  refunded_totals?: number;
  fully_paid_bookings?: number;
  partially_paid_bookings?: number;
  unpaid_bookings?: number;
  bookings_requiring_payment_attention?: number;
}

export interface ApplicationBookingReport {
  submitted_applications?: number;
  under_review_applications?: number;
  approved_applications?: number;
  rejected_applications?: number;
  pending_bookings?: number;
  confirmed_bookings?: number;
}

export type ApplicationStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "cancelled" | "archived";

export interface AcademicSession {
  id: number;
  code: string;
  name: string;
  starts_on?: string | null;
  ends_on?: string | null;
  status: string;
}

export interface Application {
  id: number;
  resident_id: number;
  academic_session_id: number;
  application_number: string;
  status: ApplicationStatus;
  submitted_at?: string | null;
  reviewed_by_staff_id?: number | null;
  reviewed_at?: string | null;
  decision_notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IdentityDocument {
  id: number;
  resident_id: number;
  document_type: "student_card" | "ghana_card" | "profile_photo" | "application_support" | "payment_slip" | "receipt_pdf" | "other";
  status: string;
  original_filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  created_at?: string;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "completed" | "archived";

export interface Booking {
  id: number;
  resident_id: number;
  academic_session_id: number;
  application_id: number;
  booking_number: string;
  status: BookingStatus;
  total_amount_minor: number;
  currency: string;
  expires_at?: string | null;
  priced_room_id?: number | null;
  priced_room_rate_id?: number | null;
  payment_attention_required?: number | boolean | null;
  payment_attention_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Room {
  id: number;
  room_code: string;
  room_name?: string | null;
  floor?: string | null;
  capacity: number;
  gender_policy: string;
  status: string;
  bed_count?: number;
  active_occupancy?: number;
  availability?: number;
  created_at?: string;
  updated_at?: string;
}

export interface RoomRate {
  id: number;
  room_id: number;
  academic_session_id: number;
  rate_code: string;
  amount_minor: number;
  currency: string;
  status: string;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Bed {
  id: number;
  room_id: number;
  bed_code: string;
  label: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface Allocation {
  id: number;
  booking_id: number;
  resident_id: number;
  academic_session_id: number;
  bed_id: number;
  status: string;
  starts_on?: string | null;
  ends_on?: string | null;
  released_at?: string | null;
  assigned_by_staff_id?: number | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AvailabilityBed {
  room_id: number;
  room_code: string;
  room_name?: string | null;
  capacity: number;
  gender_policy: string;
  bed_id: number;
  bed_code: string;
  label: string;
  amount_minor: number;
  currency: string;
}

export interface BookingPaymentSummary {
  bookingId: number;
  bookingTotalMinor: number;
  verifiedPaidMinor: number;
  balanceMinor: number;
  requiredConfirmationAmountMinor: number;
  remainingToConfirmationMinor: number;
  confirmationRequirementMet: boolean;
  bookingStatus: BookingStatus;
  paymentAttentionRequired: boolean;
}

export type PaymentStatus = "pending" | "submitted" | "verified" | "rejected" | "refunded" | "cancelled" | "archived";
export type PaymentMethod = "cash" | "bank_transfer" | "mobile_money" | "card" | "other";

export interface Payment {
  id: number;
  booking_id: number | null;
  resident_id: number;
  payment_reference: string;
  status: PaymentStatus;
  amount_minor: number;
  currency: string;
  method: PaymentMethod;
  paid_at?: string | null;
  submitted_at?: string | null;
  verified_by_staff_id?: number | null;
  verified_at?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ReceiptStatus = "issued" | "voided" | "archived";

export interface Receipt {
  id: number;
  payment_id: number;
  receipt_number: string;
  status: ReceiptStatus;
  issued_at: string;
  issued_by_staff_id?: number | null;
  voided_at?: string | null;
  void_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReceiptDetailData extends Receipt {
  payment_reference: string;
  amount_minor: number;
  method: PaymentMethod;
  paid_at?: string | null;
  verified_at?: string | null;
  booking_number?: string | null;
  total_amount_minor?: number | null;
  resident_code: string;
  resident_name: string;
  student_id?: string | null;
  institution_name?: string | null;
  issuing_staff_name?: string | null;
}

export interface MaintenanceReport {
  open?: number;
  assigned?: number;
  in_progress?: number;
  resolved?: number;
  closed?: number;
  urgent?: number;
}

export type MaintenanceStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed" | "cancelled" | "archived";
export type MaintenancePriority = "low" | "normal" | "high" | "urgent";
export type MaintenanceCategory = "plumbing" | "electrical" | "furniture" | "cleaning" | "security" | "other";

export interface MaintenanceRequest {
  id: number;
  request_number: string;
  resident_id?: number | null;
  room_id?: number | null;
  bed_id?: number | null;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  title: string;
  description?: string | null;
  assigned_to_staff_id?: number | null;
  opened_at?: string | null;
  assigned_at?: string | null;
  started_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type AnnouncementStatus = "draft" | "published" | "expired" | "archived";
export type AnnouncementSeverity = "normal" | "important" | "high_alert";
export type AnnouncementAudience = "all" | "residents" | "staff";
export type AnnouncementChannel = "resident_portal" | "staff_portal" | "public_website" | "sms" | "email";

export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  severity: AnnouncementSeverity;
  status: AnnouncementStatus;
  channels: AnnouncementChannel[];
  starts_at?: string | null;
  published_at?: string | null;
  expires_at?: string | null;
  created_by_staff_id?: number | null;
  published_by_staff_id?: number | null;
  recipient_counts?: { sms: number; email: number };
  delivery_summary?: Array<{ channel: string; status: string; count: number }>;
  created_at?: string;
  updated_at?: string;
}

export interface AnnouncementReport {
  published?: number;
  drafts?: number;
  high_alerts?: number;
  expiring_soon?: number;
}

export interface Staff {
  id: number;
  user_id: number;
  role_id: number;
  staff_code: string;
  job_title?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface Pagination {
  limit: number;
  offset: number;
}

export interface ListEnvelope<T> {
  ok: true;
  data: T[];
  pagination: Pagination;
}

export interface DataEnvelope<T> {
  ok: true;
  data: T;
}

export interface Institution {
  id: number;
  code: string;
  name: string;
  status: string;
}

export interface Resident {
  id: number;
  user_id: number;
  institution_id: number | null;
  resident_code: string;
  student_id: string | null;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  date_of_birth?: string | null;
  gender?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  address?: string | null;
  status: "prospect" | "applicant" | "resident" | "past_resident" | "suspended" | "archived";
  phone_verified_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateResidentInput {
  email?: string | null;
  phone?: string | null;
  displayName: string;
  institutionId: number;
  studentId: string;
  firstName: string;
  lastName: string;
  gender?: string | null;
  status?: string;
}
