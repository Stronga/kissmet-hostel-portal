# Resident Onboarding

## Scope

Phase 7 adds API-only resident/student-facing onboarding, profile, identity-document, application, booking, and allocation endpoints. No visual resident portal was built, and the legacy Django runtime remains untouched.

## New Applicant Registration

New applicants use:

```text
registration request -> phone OTP -> verified phone -> user/resident creation -> normal resident session
```

The public client supplies first name, optional middle name, last name, phone, optional email, institution code, and student ID. The selected institution must already exist and be active. Public clients cannot create institutions.

Duplicate `(institution_id, student_id)` registrations are detected and receive a generic response that directs the UI toward existing resident login/account recovery instead of creating a duplicate.

## Existing Resident Login

Existing residents continue to log in using:

```text
institution code + student ID + OTP to registered phone
```

`resident_code` is not used for login. Ghana Card is never an authentication credential.

## OTP Behavior

Registration OTPs reuse `otp_codes` with `purpose = 'phone_verification'`. OTPs are hashed, expire, have attempt limits, are one-time use, and use rate limiting. A fully trusted resident session is issued only after phone verification succeeds.

## Resident Creation

Successful registration creates:

- `users` row with `user_type = 'resident'`
- `residents` row with structured first/middle/last name
- generated `resident_code`
- `phone_verified_at`
- normal hashed session-token row

New registrations use `resident.status = 'applicant'`, not established resident status.

## Application Numbers

Resident applications use generated `KSM-APP-0001` style application numbers from `application_number_sequence`. They are not raw D1 primary keys.

## Routes

Public:

- `GET /public/institutions`

Registration:

- `POST /resident/register/request-otp`
- `POST /resident/register/verify-otp`

Resident self-service:

- `GET /resident/me`
- `PATCH /resident/me`
- `GET /resident/me/documents`
- `POST /resident/me/documents/student-card`
- `POST /resident/me/documents/ghana-card`
- `GET /resident/me/documents/:id`
- `GET /resident/me/applications`
- `POST /resident/me/applications`
- `GET /resident/me/applications/:id`
- `PATCH /resident/me/applications/:id`
- `POST /resident/me/applications/:id/submit`
- `GET /resident/me/bookings`
- `GET /resident/me/allocation`

Admin document review:

- `GET /admin/documents`
- `GET /admin/documents/:id`
- `GET /admin/documents/:id/content`
- `POST /admin/documents/:id/verify`
- `POST /admin/documents/:id/reject`

## Profile Ownership

Resident-facing routes derive resident identity from the authenticated session. They do not trust request-provided resident IDs. Institution and student ID are not freely editable after registration.

## Identity Documents

Student Card and Ghana Card uploads are private R2 objects with only metadata stored in D1 `documents`.

Allowed types:

- `application/pdf`
- `image/jpeg`
- `image/png`
- `image/webp`

Maximum size is 5 MB. No public R2 URLs are returned.

Ghana Card access is narrower than general resident read access and requires `document:ghana_card`. The system does not extract or store Ghana Card numbers.

## Document Verification

Residents can see their own document metadata and verification status. They cannot verify or reject documents.

Authorized staff can list pending identity-document metadata, retrieve document content through the Worker, verify documents, or reject them with a reason. Staff document access and verification decisions are audited.

## Application Submission

Residents create draft applications against the existing `applications` table. Submission requires verified phone, institution/student ID, required structured name fields, and uploaded Student Card and Ghana Card documents. Documents may still be awaiting staff verification at submission time; staff verification happens during review. Application approval remains an admin workflow and does not allocate a bed.

## Booking And Allocation Visibility

Residents can read only their own bookings and current active allocation. Booking information is read-only in Phase 7 and payment submission remains outside this phase.

## Permissions

- `super_admin`: full staff document access.
- `manager`: resident/application/document review, including Ghana Card access.
- `reception`: resident/application intake and Student Card review.
- `accounts`: no identity-document access by default.
- `maintenance`: no identity-document access.
- `resident`: own profile, own documents, own applications, own bookings, own allocation only.

## Audit Events

- `resident.registration.initiated`
- `resident.registration.phone_verified`
- `resident.registration.resident_created`
- `resident.document.student_card_uploaded`
- `resident.document.ghana_card_uploaded`
- `admin.identity_document.accessed`
- `admin.identity_document.verified`
- `admin.identity_document.rejected`
- `resident.application.created`
- `resident.application.updated`
- `resident.application.submitted`
- `resident.profile.updated`

OTP values, session tokens, Ghana Card numbers, and document contents are never logged.

## Migrations

```text
cloudflare/migrations/0006_resident_onboarding.sql
```

Adds:

- `residents.middle_name`
- `residents.phone_verified_at`
- `otp_codes.registration_payload_json`
- `application_number_sequence`

## Test Results

Latest local validation:

```text
npm.cmd run typecheck
tsc --noEmit passed

npm.cmd test
4 test files passed
55 tests passed
```
