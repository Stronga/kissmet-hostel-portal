# Kissmet Hostel Migration Audit

## 1. Current Architecture

### Framework and runtime

- Framework: Django 3.2.x (`Django==3.2.3` in `requirements.txt`; later migrations were generated with Django 3.2.7).
- Runtime: Python web application using Django WSGI/ASGI entrypoints.
- Server assumption: `gunicorn==20.1.0` is listed, but no production process file, Dockerfile, Procfile, or Cloudflare deployment config is present.
- Frontend: server-rendered Django templates with static Bootstrap, jQuery, Font Awesome, and local image assets.
- Installed Django apps:
  - `django.contrib.admin`
  - `django.contrib.auth`
  - `django.contrib.contenttypes`
  - `django.contrib.sessions`
  - `django.contrib.messages`
  - `django.contrib.staticfiles`
  - `accounts`
  - `main`
  - `profiles`
  - `bootstrap4`
  - `django_forms_bootstrap`
  - `crispy_forms`

### Current database engine

- Engine: SQLite via Django:
  - `ENGINE = 'django.db.backends.sqlite3'`
  - `NAME = BASE_DIR / 'db.sqlite3'`
- The repository includes a committed `db.sqlite3`, so local state and seed data are bundled with the codebase.

### ORM/query layer

- Query layer: Django ORM.
- No application-level direct SQL was found in Python source using `raw(`, `connection`, `cursor`, `execute(`, or `extra(`.
- Database operations are performed with model managers and querysets such as:
  - `User.objects.create_user(...)`
  - `Profile.objects.get_or_create(...)`
  - `Profile.objects.get(...)`
  - `Profile.objects.filter(...)`
  - `MessMenu.objects.create(...)`
  - `Hostel.objects.all()`
  - `StudentLeave.objects.create(...)`
  - `FeePaid.objects.filter(...).aggregate(Sum('amount'))`
  - `FeeRecords.objects.get_or_create(...)`

### Authentication system

- Authentication is Django's built-in `django.contrib.auth` user/session/password system.
- Login views are custom class-based views in `accounts/views.py`, backed by Django `User`.
- Login setting currently prefers email login:
  - `LOGIN_VIA_EMAIL = True`
  - `LOGIN_URL = 'accounts:log_in'`
  - `LOGIN_REDIRECT_URL = 'main:index'`
- Password reset and activation flows are custom wrappers around Django token utilities.
- User activation is effectively disabled:
  - `DONT_ENABLE_USER_ACTIVATION = True`
  - `ENABLE_USER_ACTIVATION = False`
- Authorization is weak:
  - Views mostly require only `@login_required`.
  - Role information is a free-text `Profile.role` field.
  - No backend permission checks enforce Admin/Staff/Student access boundaries.
- Session storage uses Django database-backed sessions by default, meaning session tables are in SQLite today.

### Room/resident/booking/payment models

- Resident/student:
  - Django `auth.User` stores username, email, password hash, first name, last name, staff/admin flags.
  - `profiles.Profile` extends each user with hostel-specific fields.
- Room:
  - No normalized `Room` model exists.
  - Room number is stored as text on `Profile.room_number`.
- Hostel:
  - `main.Hostel` stores only `hostel_name`.
- Bed:
  - No bed model exists.
- Booking/reservation/application/allocation:
  - No booking, reservation, application, room allocation, or bed allocation model exists.
- Payment:
  - `main.FeePaid` stores payment amount and a text `student_id`.
  - `main.FeeRecords` stores derived payment record fields, including balance as text.
  - Payment records are not relationally linked to `User` or `Profile`.
- Other domain models:
  - `main.MessMenu`
  - `main.StudentLeave`
  - `main.College`
  - `accounts.Activation`

### File storage implementation

- `Profile.avatar` is a Django `ImageField(upload_to="profiles/avatars/")`.
- Upload handling occurs in `profiles/views.py` through `ProfileForm(request.POST, request.FILES, instance=self.profile)`.
- File storage uses Django's default local filesystem storage.
- Media settings:
  - `MEDIA_ROOT = os.path.join(BASE_DIR, 'media')`
  - `MEDIA_URL = '/media/'`
- In debug mode, Django serves media and static files from URL patterns in `hostelmanagement/urls.py`.
- No Cloudflare R2, S3-compatible storage backend, signed upload flow, or file metadata table exists.

### Environment variables

- No project environment variables are consumed except `DJANGO_SETTINGS_MODULE` set by Django entrypoints.
- Sensitive and environment-specific values are hardcoded:
  - `SECRET_KEY`
  - `DEBUG = True`
  - `ALLOWED_HOSTS = ['*']`
  - SQLite database path
  - static/media paths
  - timezone
- `accounts/utils.py` contains email-sending helpers through Django mail APIs, but no SMTP environment configuration is present in settings.

### Deployment assumptions

- Local development assumes `python manage.py runserver`.
- Production dependency list includes `gunicorn`, implying a traditional Python server deployment.
- Static files are assumed to be local.
- Media files are assumed to be local.
- `STATIC_ROOT = '/static/'` is an absolute path and is not suitable for most production hosts.
- No Cloudflare Workers, Pages, D1, R2, Wrangler, deployment scripts, or build config exist.
- Current Django runtime cannot run directly on Cloudflare Workers without a major architecture change.

## 2. Database Schema Inventory

### Application schema files and migrations

- `accounts/migrations/0001_initial.py`
  - Creates `Activation`.
- `profiles/migrations/0001_initial.py`
  - Creates `Profile`.
- `profiles/migrations/0002_profile_code.py`
  - Adds `Profile.code`.
- `profiles/migrations/0003_alter_profile_code.py`
  - Alters `Profile.code`.
- `profiles/migrations/0004_rename_city_profile_role.py`
  - Renames `Profile.city` to `Profile.role`.
- `profiles/migrations/0005_auto_20211105_1547.py`
  - Adds `Profile.branch`, `Profile.college`, `Profile.id_number`, `Profile.semester`, `Profile.state`.
- `profiles/migrations/0006_profile_year.py`
  - Adds `Profile.year`.
- `profiles/migrations/0007_alter_profile_code.py`
  - Alters `Profile.code`.
- `profiles/migrations/0008_auto_20220201_0759.py`
  - Renames `Profile.branch` to `Profile.hostel`.
  - Renames `Profile.state` to `Profile.room_number`.
- `main/migrations/0001_initial.py`
  - Creates `MessMenu`.
- `main/migrations/0002_studentleave.py`
  - Creates `StudentLeave`.
- `main/migrations/0003_auto_20220102_1356.py`
  - Adds meal price fields to `MessMenu`.
- `main/migrations/0004_hostel.py`
  - Creates `Hostel`.
- `main/migrations/0005_college.py`
  - Creates `College`.
- `main/migrations/0006_feepaid.py`
  - Creates `FeePaid`.
- `main/migrations/0007_feerecords.py`
  - Creates `FeeRecords`.
- `main/migrations/0008_auto_20220201_0901.py`
  - Adds `College.fee_amount`.
  - Adds `College.students` many-to-many relation to `auth.User`.
- `main/migrations/0009_auto_20220201_1003.py`
  - Converts `College.fee_amount`, `FeePaid.amount`, and `FeeRecords.amount_paid` to decimal fields.

### Custom tables/models

#### `accounts.Activation`

- `id`: `BigAutoField`, primary key.
- `user`: foreign key to Django auth user, cascade delete.
- `created_at`: datetime, auto-created.
- `code`: unique char field, max length 20.
- `email`: email field, optional.

#### `profiles.Profile`

- `id`: `BigAutoField`, primary key.
- `user`: one-to-one relation to Django auth user, cascade delete.
- `avatar`: image path, local upload.
- `id_number`: text.
- `college`: text.
- `semester`: text.
- `hostel`: text.
- `room_number`: text.
- `year`: text.
- `birthday`: date.
- `gender`: small integer choice.
- `phone`: text.
- `address`: text.
- `code`: text.
- `number`: text.
- `role`: text.
- `created_at`: datetime, auto-created.
- `updated_at`: datetime, auto-updated.

#### `main.MessMenu`

- `id`: `BigAutoField`, primary key.
- `day`: text.
- `breakfast`: text.
- `breakfast_price`: text.
- `lunch`: text.
- `lunch_price`: text.
- `dinner`: text.
- `dinner_price`: text.
- `date_created`: datetime, auto-created.
- `updated`: datetime, auto-updated.

#### `main.StudentLeave`

- `id`: `BigAutoField`, primary key.
- `user`: one-to-one relation to Django auth user, cascade delete.
- `place_visiting`: text.
- `departure_date`: text, not a date type.
- `arrival_date`: text, not a date type.
- `reason`: text.
- `date_created`: datetime, auto-created.
- `updated`: datetime, auto-updated.

#### `main.Hostel`

- `id`: `BigAutoField`, primary key.
- `hostel_name`: text.
- `date_created`: datetime, auto-created.
- `updated`: datetime, auto-updated.

#### `main.College`

- `id`: `BigAutoField`, primary key.
- `college_name`: text.
- `students`: many-to-many relation to Django auth user through an implicit join table.
- `fee_amount`: decimal.
- `date_created`: datetime, auto-created.
- `updated`: datetime, auto-updated.

#### `main.FeePaid`

- `id`: `BigAutoField`, primary key.
- `amount`: decimal.
- `student_id`: text.
- `date_created`: datetime, auto-created.
- `updated`: datetime, auto-updated.

#### `main.FeeRecords`

- `id`: `BigAutoField`, primary key.
- `student_id`: text.
- `student_name`: text.
- `college`: text.
- `amount_paid`: decimal.
- `balance`: text.
- `date_created`: datetime, auto-created.
- `updated`: datetime, auto-updated.

### Django-managed tables expected from installed apps

- `auth_user`
- `auth_group`
- `auth_permission`
- `auth_user_groups`
- `auth_user_user_permissions`
- `django_admin_log`
- `django_content_type`
- `django_migrations`
- `django_session`
- App tables generated from custom migrations above.

## 3. Database Query Inventory

### `main/views.py`

- `user_registration`
  - Creates `User`.
  - Gets or creates `Profile`.
  - Saves free-text role.
- `user_profile`
  - Filters `Profile` by current user and takes first result by index.
- `edit_profile`
  - Gets `Profile` by id.
  - Updates ID number and phone.
- `admin_dashboard`, `admin_details`, `student_dashboard`
  - Gets/filter current user's `Profile`.
- `mess_details`
  - Reads all `MessMenu`.
- `add_mess_menu`
  - Creates `MessMenu`.
- `add_hostel`
  - Creates `Hostel`.
- `edit_hostel_staff`
  - Gets `Profile`.
  - Gets `User` by username.
  - Updates user/profile fields.
- `hostel_staff_details`
  - Filters `Profile.role` with case-insensitive contains queries for Janitor/Staff/house keeping.
- `student_details`
  - Filters `Profile.role = 'Student'`.
- `delete_student`
  - Gets and deletes `User`.
- `delete_menu`
  - Gets and deletes `MessMenu`.
- `edit_student`
  - Reads all `Hostel`.
  - Gets `Profile`.
  - Gets `User` by username.
  - Updates denormalized student fields on `Profile`.
- `student_leave`
  - Searches `User` by first name, last name, or username with `icontains`.
  - Reads all `StudentLeave`.
- `add_student_leave`
  - Gets `User`.
  - Creates `StudentLeave`.
- `add_school_fees`
  - Reads all `FeePaid`.
  - Creates `FeePaid`.
  - Hardcodes lookup for `User.username = 'moriss'`.
  - Filters `College` by many-to-many student id.
  - Iterates related students.
  - Filters `FeePaid` by `student_id`.
  - Aggregates sum of amount.
  - Gets or creates `FeeRecords`.
  - Saves derived fee record.
- `fees_records`
  - Reads all `FeeRecords`.
- `all_students_leave`
  - Reads all `StudentLeave`.
- `search_student`
  - Searches `User` by first name, last name, or username with `icontains`.

### `accounts/forms.py`

- Sign-in and account recovery forms query `User` by username and/or case-insensitive email.
- Duplicate email checks use `.exists()`.
- Activation checks use reverse relation `user.activation_set.first()`.

### `accounts/views.py`

- Creates and saves `User`.
- Creates and deletes `Activation`.
- Gets activation by code.
- Updates `User.is_active`, email, profile names, and password.
- Uses Django login/session machinery.

### `profiles/views.py`

- Gets or creates `Profile` for current user.
- Saves `ProfileForm`, including uploaded avatar.
- Updates related `User` first name, last name, and email.

### Direct SQL query inventory

- No direct application SQL queries found in Python source.
- SQL is generated by Django ORM and migrations.

## 4. D1 Compatibility Risks

- Django cannot use Cloudflare D1 as a drop-in database through the standard SQLite backend. D1 is SQLite-compatible at the SQL dialect level, but access is through Cloudflare Workers bindings/API, not a normal local SQLite file connection.
- The current application is a Python WSGI/ASGI app. Cloudflare Workers run JavaScript/WebAssembly isolates, so the app cannot be deployed unchanged to Workers.
- Django auth, sessions, admin, migrations, and contenttypes assume a traditional relational database connection and Django runtime.
- Django migrations are Python migration files, while D1 migrations should be SQL migration files run through Wrangler or a D1-compatible migration tool.
- `BigAutoField` maps to integer primary keys in SQLite, but D1 migration SQL should explicitly define compatible `INTEGER PRIMARY KEY` behavior.
- `DecimalField` on SQLite is not true fixed precision. D1 also has SQLite affinity behavior; payment amounts should use integer minor units or carefully controlled text/decimal handling.
- Django `DateTimeField(auto_now_add/auto_now)` behavior is application-managed. D1 schema should use explicit timestamps and application code should set/update them predictably.
- Django `ImageField` stores local file paths and depends on filesystem-backed media storage. Cloudflare deployment needs R2 object keys and metadata.
- Django database sessions are not automatically compatible with a Workers/D1 app unless reimplemented.
- `icontains` queries map to SQL `LIKE` behavior; D1 support exists, but case-insensitive semantics and indexing should be validated.
- Many-to-many implicit Django tables are generated by Django. A D1-first app should use explicit join tables.
- Existing role checks rely on mutable text fields and UI routing, not backend authorization policies.
- Existing payment logic has a hardcoded username lookup and denormalized fee records, which is not safe for production migration.
- Existing schema lacks required Kissmet tables for rooms, beds, applications, bookings, allocations, documents, OTP codes, audit logs, and maintenance requests.
- SQLite file `db.sqlite3` is committed and not suitable as a production source of truth.

## 5. Modules To KEEP / MODIFY / REMOVE / ADD

### KEEP

- Basic Django source as reference for local module discovery.
- Template concepts for admin/student pages, as rough workflow references.
- `Profile` concept as a resident/staff profile idea, but not its current schema unchanged.
- `Hostel` concept only as a starting point for building room/bed inventory.
- `FeePaid` and `FeeRecords` concepts only as references for payment record screens.

### MODIFY

- `accounts`
  - Replace email/password-only resident flow with Resident ID plus OTP for residents.
  - Keep password-based admin/staff login concept.
  - Add backend role/permission enforcement.
- `profiles`
  - Rename/rebuild Student/Profile into Resident/Staff profile schema.
  - Replace local avatar storage with R2 object references.
- `main`
  - Split broad view module into focused admin/resident/domain modules.
  - Replace string room fields with normalized rooms, beds, bookings, and allocations.
  - Replace fee logic with relational payment records and receipts.
- Templates
  - Keep useful screen structure, but adapt labels and workflows to Kissmet Hostel.
- Settings/config
  - Move secrets and environment-specific settings to environment variables for local/staging/production.

### REMOVE

- Mess/menu functionality unless Kissmet explicitly needs meal/menu management.
- College-centric fields if the hostel is not tied to multiple colleges.
- Student leave workflow unless it maps to a real Kissmet process.
- Hardcoded demo credentials and hardcoded user lookup `moriss`.
- Committed SQLite database as an operational dependency.
- Local media-serving assumptions for production.
- Free-text role authorization.
- Generated `__pycache__` files from repository tracking.

### ADD

- D1 SQL migrations.
- D1 data access layer compatible with Cloudflare Workers.
- Resident table with Kissmet resident ID.
- Staff table and explicit role/permission tables.
- Academic sessions.
- Rooms.
- Beds.
- Applications.
- Bookings.
- Allocations.
- Payments.
- Receipts.
- Documents with R2 object metadata.
- Maintenance requests.
- Announcements.
- OTP codes with expiry, attempt limits, rate limiting, and one-time use.
- Sessions compatible with the target runtime.
- Audit logs.
- Reports for occupancy, residents, availability, bookings, payments, balances, maintenance, check-ins, and check-outs.
- Seed/import tooling for initial hostel setup.
- Cloudflare Wrangler configuration for D1/R2/Workers.

## 6. Recommended Migration Order

1. Freeze the current Django project as a reference branch and do not continue feature work against the legacy schema.
2. Decide target runtime architecture for Cloudflare:
   - Recommended: rebuild backend/API for Cloudflare Workers with D1 and R2.
   - Alternative: keep Django on a traditional host and use Cloudflare only for DNS/CDN/security, but this does not meet the D1/Workers architecture in the project flow.
3. Define the canonical Kissmet domain schema in SQL-first D1 migrations:
   - users, residents, staff, roles, permissions, academic_sessions.
   - rooms, beds.
   - applications, bookings, allocations.
   - payments, receipts, documents.
   - maintenance_requests, announcements, otp_codes, sessions, audit_logs.
4. Build the D1 data access layer and transaction patterns before UI work.
5. Implement authentication:
   - Admin/staff email or username plus password.
   - Resident ID plus OTP.
   - Backend role and permission checks.
6. Build admin portal foundations:
   - Staff login, dashboard, academic sessions, rooms, beds, residents.
7. Build booking/allocation workflow:
   - Applications, bookings, bed assignment, occupancy rules.
   - Application approval must not automatically allocate a bed; allocation must remain an explicit staff placement action.
8. Build payment workflow:
   - Manual payment records, payment slip upload metadata, admin verification, receipt records.
9. Add R2-backed document upload/storage:
   - IDs, profile photos, payment slips, receipts, supporting documents.
10. Build resident portal:
   - Profile, application, booking, room/bed, payments, documents, maintenance, announcements.
11. Add maintenance requests and announcements.
12. Add reports and exports.
13. Create import scripts for existing residents, rooms, beds, balances, and staff.
14. Configure Cloudflare staging with separate D1/R2 resources.
15. Run local and staging tests for OTP, permissions, duplicate booking prevention, occupied bed prevention, payments, uploads, and reports.
16. Prepare production Cloudflare resources, DNS, secrets, rate limits, and handover documentation.

## Review Notes

- Runtime DB inspection through Django management commands could not be executed because Django is not installed in the current environment.
- Application source and migration files were reviewed directly.
- No application files were modified as part of this audit, except for adding this requested audit document.
