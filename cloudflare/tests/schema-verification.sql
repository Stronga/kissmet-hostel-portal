PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO users (email, phone, display_name, user_type, status)
VALUES ('verification.resident@example.com', '+233000009001', 'Verification Resident', 'resident', 'active');

INSERT OR IGNORE INTO institutions (code, name, status)
VALUES ('verify-school', 'Verification School', 'active');

INSERT OR IGNORE INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status)
SELECT u.id, i.id, 'KSM-VERIFY-STU', 'Verification', 'Resident', 'female', 'applicant'
FROM users u
JOIN institutions i ON i.code = 'verify-school'
WHERE u.email = 'verification.resident@example.com';

INSERT OR IGNORE INTO rooms (room_code, room_name, floor, capacity, gender_policy, status)
VALUES ('VERIFY-ROOM-1', 'Verification Room 1', 'T', 2, 'female', 'available');

INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'VERIFY-ROOM-1-A', 'A', 'available' FROM rooms WHERE room_code = 'VERIFY-ROOM-1';

INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'VERIFY-ROOM-1-B', 'B', 'available' FROM rooms WHERE room_code = 'VERIFY-ROOM-1';

INSERT OR IGNORE INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status, effective_from, effective_to)
SELECT room.id, session.id, 'VERIFY-RATE-1', 250000, 'GHS', 'active', session.starts_on, session.ends_on
FROM rooms room, academic_sessions session
WHERE room.room_code = 'VERIFY-ROOM-1'
  AND session.code = '2026-2027';

INSERT OR IGNORE INTO applications (resident_id, academic_session_id, application_number, status, submitted_at)
SELECT r.id, s.id, 'VERIFY-APP-1', 'submitted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM residents r, academic_sessions s
JOIN institutions i ON i.id = r.institution_id
WHERE i.code = 'verify-school' AND r.student_id = 'KSM-VERIFY-STU' AND s.code = '2026-2027';

INSERT OR IGNORE INTO bookings (resident_id, academic_session_id, application_id, booking_number, status, total_amount_minor, currency)
SELECT r.id, s.id, a.id, 'VERIFY-BOOK-1', 'confirmed', 250000, 'GHS'
FROM residents r, academic_sessions s, applications a
JOIN institutions i ON i.id = r.institution_id
WHERE i.code = 'verify-school' AND r.student_id = 'KSM-VERIFY-STU'
  AND s.code = '2026-2027'
  AND a.application_number = 'VERIFY-APP-1';

INSERT OR IGNORE INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on)
SELECT b.id, r.id, s.id, bed.id, 'active', '2026-09-01'
FROM bookings b, residents r, academic_sessions s, beds bed
WHERE b.booking_number = 'VERIFY-BOOK-1'
  AND r.student_id = 'KSM-VERIFY-STU'
  AND s.code = '2026-2027'
  AND bed.bed_code = 'VERIFY-ROOM-1-A';

INSERT OR IGNORE INTO payments (booking_id, resident_id, payment_reference, status, amount_minor, currency, method, paid_at, submitted_at)
SELECT b.id, r.id, 'VERIFY-PAY-1', 'submitted', 125000, 'GHS', 'bank_transfer', '2026-09-01T00:00:00.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM bookings b, residents r
WHERE b.booking_number = 'VERIFY-BOOK-1'
  AND r.student_id = 'KSM-VERIFY-STU';

INSERT OR IGNORE INTO receipts (payment_id, receipt_number, status)
SELECT id, 'VERIFY-REC-1', 'issued'
FROM payments
WHERE payment_reference = 'VERIFY-PAY-1';

INSERT OR IGNORE INTO documents (owner_user_id, resident_id, payment_id, receipt_id, document_type, status, r2_bucket, r2_key, original_filename, content_type, size_bytes)
SELECT u.id, r.id, p.id, rec.id, 'receipt_pdf', 'uploaded', 'kissmet-hostel-local-documents', 'verification/receipts/VERIFY-REC-1.pdf', 'VERIFY-REC-1.pdf', 'application/pdf', 1024
FROM users u, residents r, payments p, receipts rec
WHERE u.email = 'verification.resident@example.com'
  AND r.student_id = 'KSM-VERIFY-STU'
  AND p.payment_reference = 'VERIFY-PAY-1'
  AND rec.receipt_number = 'VERIFY-REC-1';

INSERT OR IGNORE INTO maintenance_requests (request_number, resident_id, room_id, bed_id, category, priority, status, title, description)
SELECT 'VERIFY-MAINT-1', r.id, room.id, bed.id, 'furniture', 'normal', 'open', 'Verification maintenance', 'Schema verification request'
FROM residents r, rooms room, beds bed
JOIN institutions i ON i.id = r.institution_id
WHERE i.code = 'verify-school' AND r.student_id = 'KSM-VERIFY-STU'
  AND room.room_code = 'VERIFY-ROOM-1'
  AND bed.bed_code = 'VERIFY-ROOM-1-A';

INSERT OR IGNORE INTO announcements (title, body, audience, status, published_at)
VALUES ('Verification Announcement', 'Schema verification announcement.', 'all', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO otp_codes (user_id, resident_id, destination, purpose, code_hash, rate_limit_key, expires_at)
SELECT u.id, r.id, u.phone, 'resident_login', 'verification-hash-only', 'otp:resident_login:+233000009001', datetime('now', '+10 minutes')
FROM users u, residents r
WHERE u.email = 'verification.resident@example.com'
  AND r.student_id = 'KSM-VERIFY-STU';

INSERT OR IGNORE INTO sessions (user_id, session_token_hash, status, expires_at)
SELECT id, 'verification-session-token-hash', 'active', datetime('now', '+8 hours')
FROM users
WHERE email = 'verification.resident@example.com';

INSERT OR IGNORE INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata_json)
SELECT u.id, 'schema.verify', 'resident', r.id, '{"phase":"2"}'
FROM users u, residents r
WHERE u.email = 'verification.resident@example.com'
  AND r.student_id = 'KSM-VERIFY-STU';

SELECT
  'resident_code_sequence' AS table_name,
  next_value AS row_count
FROM resident_code_sequence
WHERE id = 1;
SELECT
  'booking_number_sequence' AS table_name,
  next_value AS row_count
FROM booking_number_sequence
WHERE id = 1;
SELECT
  'payment_reference_sequence' AS table_name,
  next_value AS row_count
FROM payment_reference_sequence
WHERE id = 1;
SELECT
  'receipt_number_sequence' AS table_name,
  next_value AS row_count
FROM receipt_number_sequence
WHERE id = 1;
SELECT 'payment_confirmation_settings' AS table_name, COUNT(*) AS row_count FROM payment_confirmation_settings;
SELECT
  'application_number_sequence' AS table_name,
  next_value AS row_count
FROM application_number_sequence
WHERE id = 1;
SELECT
  'maintenance_request_sequence' AS table_name,
  next_value AS row_count
FROM maintenance_request_sequence
WHERE id = 1;
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users;
SELECT 'institutions' AS table_name, COUNT(*) AS row_count FROM institutions;
SELECT 'residents' AS table_name, COUNT(*) AS row_count FROM residents;
SELECT 'rooms' AS table_name, COUNT(*) AS row_count FROM rooms;
SELECT 'beds' AS table_name, COUNT(*) AS row_count FROM beds;
SELECT 'room_rates' AS table_name, COUNT(*) AS row_count FROM room_rates;
SELECT 'applications' AS table_name, COUNT(*) AS row_count FROM applications;
SELECT 'bookings' AS table_name, COUNT(*) AS row_count FROM bookings;
SELECT 'allocations' AS table_name, COUNT(*) AS row_count FROM allocations;
SELECT 'payments' AS table_name, COUNT(*) AS row_count FROM payments;
SELECT 'receipts' AS table_name, COUNT(*) AS row_count FROM receipts;
SELECT 'documents' AS table_name, COUNT(*) AS row_count FROM documents;
SELECT 'maintenance_requests' AS table_name, COUNT(*) AS row_count FROM maintenance_requests;
SELECT 'announcements' AS table_name, COUNT(*) AS row_count FROM announcements;
SELECT 'otp_codes' AS table_name, COUNT(*) AS row_count FROM otp_codes;
SELECT 'sessions' AS table_name, COUNT(*) AS row_count FROM sessions;
SELECT 'audit_logs' AS table_name, COUNT(*) AS row_count FROM audit_logs;
