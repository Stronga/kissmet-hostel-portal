PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO roles (code, name, description, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full administrative access for Kissmet Hostel setup and operations.', 1),
  ('manager', 'Manager', 'Hostel manager with operational oversight.', 1),
  ('reception', 'Reception', 'Front desk and resident intake operations.', 1),
  ('accounts', 'Accounts', 'Payment verification and receipt operations.', 1),
  ('maintenance', 'Maintenance', 'Maintenance request handling.', 1);

INSERT OR IGNORE INTO users (email, username, phone, display_name, user_type, status, password_hash) VALUES
  ('admin@kissmetgroup.org', 'admin', '+233000000001', 'Kissmet Admin', 'staff', 'active', 'pbkdf2-sha256$210000$dev-staff-salt-0001$67838b5f4afa2b33806b8c7f9b338bfbe11be699988ba94b1a83df9287961dda'),
  ('manager@kissmetgroup.org', 'manager', '+233000000002', 'Kissmet Manager', 'staff', 'active', 'pbkdf2-sha256$210000$dev-staff-salt-0001$67838b5f4afa2b33806b8c7f9b338bfbe11be699988ba94b1a83df9287961dda'),
  ('ama.resident@example.com', NULL, '+233000000101', 'Ama Resident', 'resident', 'active', NULL),
  ('kojo.resident@example.com', NULL, '+233000000102', 'Kojo Resident', 'resident', 'active', NULL);

INSERT OR IGNORE INTO staff (user_id, role_id, staff_code, job_title, status)
SELECT u.id, r.id, 'KSM-STF-001', 'System Administrator', 'active'
FROM users u, roles r
WHERE u.email = 'admin@kissmetgroup.org' AND r.code = 'super_admin';

INSERT OR IGNORE INTO staff (user_id, role_id, staff_code, job_title, status)
SELECT u.id, r.id, 'KSM-STF-002', 'Hostel Manager', 'active'
FROM users u, roles r
WHERE u.email = 'manager@kissmetgroup.org' AND r.code = 'manager';

INSERT OR IGNORE INTO academic_sessions (code, name, starts_on, ends_on, status) VALUES
  ('2026-2027', '2026/2027 Academic Year', '2026-09-01', '2027-08-31', 'active');

INSERT OR IGNORE INTO institutions (code, name, status) VALUES
  ('ug', 'University of Ghana', 'active'),
  ('knust', 'Kwame Nkrumah University of Science and Technology', 'active');

INSERT OR IGNORE INTO residents (user_id, institution_id, resident_code, student_id, first_name, last_name, gender, guardian_name, guardian_phone, status, phone_verified_at)
SELECT u.id, i.id, 'KSM-RES-9001', 'KSM-STU-0001', 'Ama', 'Resident', 'female', 'Akosua Resident', '+233000000201', 'applicant', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN institutions i ON i.code = 'ug'
WHERE u.email = 'ama.resident@example.com';

INSERT OR IGNORE INTO residents (user_id, institution_id, resident_code, student_id, first_name, last_name, gender, guardian_name, guardian_phone, status, phone_verified_at)
SELECT u.id, i.id, 'KSM-RES-9002', 'KSM-STU-0002', 'Kojo', 'Resident', 'male', 'Kwame Resident', '+233000000202', 'applicant', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
JOIN institutions i ON i.code = 'knust'
WHERE u.email = 'kojo.resident@example.com';

INSERT OR IGNORE INTO rooms (room_code, room_name, floor, capacity, gender_policy, status) VALUES
  ('ROOM-101', 'Room 101', '1', 2, 'female', 'available'),
  ('ROOM-102', 'Room 102', '1', 2, 'male', 'available'),
  ('ROOM-201', 'Room 201', '2', 4, 'any', 'available');

INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-101-A', 'A', 'available' FROM rooms WHERE room_code = 'ROOM-101';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-101-B', 'B', 'available' FROM rooms WHERE room_code = 'ROOM-101';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-102-A', 'A', 'available' FROM rooms WHERE room_code = 'ROOM-102';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-102-B', 'B', 'available' FROM rooms WHERE room_code = 'ROOM-102';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-201-A', 'A', 'available' FROM rooms WHERE room_code = 'ROOM-201';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-201-B', 'B', 'available' FROM rooms WHERE room_code = 'ROOM-201';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-201-C', 'C', 'available' FROM rooms WHERE room_code = 'ROOM-201';
INSERT OR IGNORE INTO beds (room_id, bed_code, label, status)
SELECT id, 'ROOM-201-D', 'D', 'available' FROM rooms WHERE room_code = 'ROOM-201';

INSERT OR IGNORE INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status, effective_from, effective_to)
SELECT room.id, session.id, room.room_code || '-2026-2027', 250000, 'GHS', 'active', session.starts_on, session.ends_on
FROM rooms room, academic_sessions session
WHERE room.room_code IN ('ROOM-101', 'ROOM-102')
  AND session.code = '2026-2027';

INSERT OR IGNORE INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status, effective_from, effective_to)
SELECT room.id, session.id, room.room_code || '-2026-2027', 300000, 'GHS', 'active', session.starts_on, session.ends_on
FROM rooms room, academic_sessions session
WHERE room.room_code = 'ROOM-201'
  AND session.code = '2026-2027';
