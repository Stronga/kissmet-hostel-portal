PRAGMA foreign_keys = ON;

INSERT INTO room_rates (room_id, academic_session_id, rate_code, amount_minor, currency, status)
SELECT room.id, session.id, 'VERIFY-RATE-DUPLICATE', 300000, 'GHS', 'active'
FROM rooms room, academic_sessions session
WHERE room.room_code = 'VERIFY-ROOM-1'
  AND session.code = '2026-2027';
