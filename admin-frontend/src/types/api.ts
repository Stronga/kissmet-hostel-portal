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

export interface MaintenanceReport {
  open?: number;
  assigned?: number;
  in_progress?: number;
  resolved?: number;
  urgent?: number;
}
