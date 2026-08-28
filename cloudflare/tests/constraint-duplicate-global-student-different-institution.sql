PRAGMA foreign_keys = ON;

INSERT INTO users (email, phone, display_name, user_type, status)
VALUES ('same.student.other.school@example.com', '+233000009003', 'Same Student Different Institution', 'resident', 'active');

INSERT INTO institutions (code, name, status)
VALUES ('verify-school-2', 'Verification School 2', 'active');

INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status)
SELECT u.id, i.id, 'KSM-VERIFY-STU', 'Other', 'Institution', 'female', 'applicant'
FROM users u
JOIN institutions i ON i.code = 'verify-school-2'
WHERE u.email = 'same.student.other.school@example.com';
