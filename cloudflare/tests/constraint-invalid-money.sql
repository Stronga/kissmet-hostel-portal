PRAGMA foreign_keys = ON;

INSERT INTO payments (resident_id, payment_reference, status, amount_minor, currency, method)
SELECT r.id, 'VERIFY-PAY-INVALID-MONEY', 'submitted', 0, 'GHS', 'cash'
FROM residents r
JOIN institutions i ON i.id = r.institution_id
WHERE i.code = 'verify-school'
  AND r.student_id = 'KSM-VERIFY-STU';
