PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  display_name TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('resident', 'staff', 'system')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'archived')),
  password_hash TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  role_id INTEGER NOT NULL,
  staff_code TEXT NOT NULL UNIQUE,
  job_title TEXT,
  hire_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
);

CREATE TABLE academic_sessions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (starts_on <= ends_on)
);

CREATE TABLE institutions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE residents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  institution_id INTEGER,
  resident_code TEXT NOT NULL UNIQUE DEFAULT ('KSM-RES-' || lower(hex(randomblob(8)))),
  student_id TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth TEXT,
  gender TEXT CHECK (gender IN ('female', 'male', 'other', 'not_specified')),
  guardian_name TEXT,
  guardian_phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'applicant', 'resident', 'past_resident', 'suspended', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  CHECK ((student_id IS NULL AND institution_id IS NULL) OR (student_id IS NOT NULL AND institution_id IS NOT NULL))
);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  room_name TEXT,
  floor TEXT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  gender_policy TEXT NOT NULL DEFAULT 'any' CHECK (gender_policy IN ('female', 'male', 'any')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance', 'inactive', 'archived')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE beds (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL,
  bed_code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance', 'inactive', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT,
  UNIQUE (room_id, label)
);

CREATE TABLE room_rates (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL,
  academic_session_id INTEGER NOT NULL,
  rate_code TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  effective_from TEXT,
  effective_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to)
);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL,
  academic_session_id INTEGER NOT NULL,
  application_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'archived')),
  submitted_at TEXT,
  reviewed_by_staff_id INTEGER,
  reviewed_at TEXT,
  decision_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL,
  academic_session_id INTEGER NOT NULL,
  application_id INTEGER,
  booking_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'completed', 'archived')),
  total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  booked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  cancelled_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE allocations (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  resident_id INTEGER NOT NULL,
  academic_session_id INTEGER NOT NULL,
  bed_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled', 'transferred', 'archived')),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  assigned_by_staff_id INTEGER,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR starts_on <= ends_on)
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER,
  resident_id INTEGER NOT NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'verified', 'rejected', 'refunded', 'cancelled', 'archived')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = upper(currency) AND length(currency) = 3),
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'card', 'other')),
  paid_at TEXT,
  submitted_at TEXT,
  verified_by_staff_id INTEGER,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT,
  FOREIGN KEY (verified_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL UNIQUE,
  receipt_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voided', 'archived')),
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  issued_by_staff_id INTEGER,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (issued_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  owner_user_id INTEGER,
  resident_id INTEGER,
  application_id INTEGER,
  booking_id INTEGER,
  payment_id INTEGER,
  receipt_id INTEGER,
  document_type TEXT NOT NULL CHECK (document_type IN ('student_card', 'ghana_card', 'profile_photo', 'application_support', 'payment_slip', 'receipt_pdf', 'other')),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'verified', 'rejected', 'deleted', 'archived')),
  r2_bucket TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  content_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum_sha256 TEXT,
  uploaded_by_user_id INTEGER,
  verified_by_staff_id INTEGER,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (verified_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE maintenance_requests (
  id INTEGER PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  resident_id INTEGER,
  room_id INTEGER,
  bed_id INTEGER,
  category TEXT NOT NULL CHECK (category IN ('plumbing', 'electrical', 'furniture', 'cleaning', 'security', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled', 'archived')),
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_staff_id INTEGER,
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'residents', 'staff')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'expired', 'archived')),
  published_by_staff_id INTEGER,
  published_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (published_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  resident_id INTEGER,
  destination TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('resident_login', 'phone_verification', 'password_reset')),
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'revoked')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  request_ip_hash TEXT,
  rate_limit_key TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  CHECK (attempt_count <= max_attempts)
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor_user_id INTEGER,
  actor_staff_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  metadata_json TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_one_active_academic_session
  ON academic_sessions(status)
  WHERE status = 'active';

CREATE UNIQUE INDEX idx_applications_one_active_per_resident_session
  ON applications(resident_id, academic_session_id)
  WHERE status IN ('draft', 'submitted', 'under_review', 'approved');

CREATE UNIQUE INDEX idx_bookings_one_active_per_resident_session
  ON bookings(resident_id, academic_session_id)
  WHERE status IN ('pending', 'confirmed');

CREATE UNIQUE INDEX idx_allocations_one_active_bed
  ON allocations(bed_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX idx_allocations_one_active_resident_session
  ON allocations(resident_id, academic_session_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX idx_room_rates_one_active_per_room_session
  ON room_rates(room_id, academic_session_id)
  WHERE status = 'active';

CREATE INDEX idx_users_type_status ON users(user_type, status);
CREATE INDEX idx_staff_role_status ON staff(role_id, status);
CREATE INDEX idx_institutions_status ON institutions(status);
CREATE UNIQUE INDEX idx_residents_institution_student_unique ON residents(institution_id, student_id) WHERE student_id IS NOT NULL;
CREATE INDEX idx_residents_institution_status ON residents(institution_id, status);
CREATE INDEX idx_residents_status ON residents(status);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_beds_room_status ON beds(room_id, status);
CREATE INDEX idx_room_rates_session_status ON room_rates(academic_session_id, status);
CREATE INDEX idx_room_rates_room_status ON room_rates(room_id, status);
CREATE INDEX idx_applications_status_session ON applications(status, academic_session_id);
CREATE INDEX idx_bookings_status_session ON bookings(status, academic_session_id);
CREATE INDEX idx_allocations_session_status ON allocations(academic_session_id, status);
CREATE INDEX idx_payments_resident_status ON payments(resident_id, status);
CREATE INDEX idx_payments_booking_status ON payments(booking_id, status);
CREATE INDEX idx_documents_resident_type ON documents(resident_id, document_type);
CREATE INDEX idx_maintenance_status_priority ON maintenance_requests(status, priority);
CREATE INDEX idx_announcements_status_audience ON announcements(status, audience);
CREATE INDEX idx_otp_rate_limit ON otp_codes(rate_limit_key, purpose, requested_at);
CREATE INDEX idx_otp_destination_status ON otp_codes(destination, purpose, status);
CREATE INDEX idx_sessions_user_status ON sessions(user_id, status);
CREATE INDEX idx_sessions_expiration ON sessions(status, expires_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_actor_time ON audit_logs(actor_user_id, created_at);
