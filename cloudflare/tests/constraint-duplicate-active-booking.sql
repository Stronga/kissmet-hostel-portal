PRAGMA foreign_keys = ON;

INSERT INTO bookings (resident_id, academic_session_id, booking_number, status, total_amount_minor, currency)
SELECT r.id, s.id, 'VERIFY-BOOK-DUPLICATE', 'pending', 250000, 'GHS'
FROM residents r, academic_sessions s, institutions i
WHERE i.id = r.institution_id
  AND i.code = 'verify-school'
  AND r.student_id = 'KSM-VERIFY-STU'
  AND s.code = '2026-2027';
