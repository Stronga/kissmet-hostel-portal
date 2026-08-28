PRAGMA foreign_keys = ON;

INSERT INTO users (email, phone, display_name, user_type, status)
VALUES ('duplicate.student@example.com', '+233000009002', 'Duplicate Student', 'resident', 'active');

INSERT INTO residents (user_id, institution_id, student_id, first_name, last_name, gender, status)
SELECT u.id, i.id, 'KSM-VERIFY-STU', 'Duplicate', 'Student', 'female', 'applicant'
FROM users u
JOIN institutions i ON i.code = 'verify-school'
WHERE u.email = 'duplicate.student@example.com';
