PRAGMA foreign_keys = ON;

INSERT INTO allocations (booking_id, resident_id, academic_session_id, bed_id, status, starts_on)
SELECT b.id, r.id, s.id, bed.id, 'active', '2026-09-01'
FROM bookings b, residents r, academic_sessions s, beds bed, institutions i
WHERE b.booking_number = 'VERIFY-BOOK-1'
  AND i.id = r.institution_id
  AND i.code = 'ug'
  AND r.student_id = 'KSM-STU-0001'
  AND s.code = '2026-2027'
  AND bed.bed_code = 'VERIFY-ROOM-1-A';
