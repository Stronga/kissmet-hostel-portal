# Document access

Identity documents (Student Card and Ghana Card) and payment slips are stored in a private R2 bucket and are only served through authenticated Worker routes. Object keys are opaque UUIDs under `objects/`. They do not include resident ids, document types, payment references, or filenames.

## Authorisation

- Admin list (`GET /admin/documents`) requires `document:read`. Ghana Card rows are included only when the caller also has `document:ghana_card`. Callers without that permission receive `restrictedResidentIds` so the UI can say a restricted document exists, without filenames or content types.
- Admin metadata and content for a Ghana Card require `document:ghana_card`. Reception receives 403.
- Payment slip content (`GET /admin/payments/:id/slip/content`) requires `payment:read`.
- Receipt PDF content (`GET /admin/receipts/:id/pdf`) requires `receipt:read`. Receipt PDFs are not generated yet; the route returns 404 until a `receipt_pdf` object has been stored.
- Residents may list, download, and — only after a rejection — replace their own identity documents. Uploaded or verified files cannot be replaced.

## Downloads

Content is always proxied by the Worker with `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and an allowlisted `Content-Type` (otherwise `application/octet-stream`). There are no public or long-lived signed URLs.

## Uploads

Uploads are limited to PDF, JPEG, PNG, and WebP, 5 MB, with matching extension, MIME type, and magic bytes.

## Audit

List, metadata, and content access are written to `audit_logs`. Metadata does not include filenames, Ghana Card numbers, or other resident PII. The admin list/detail view surfaces last content access from those audit rows.

## Pending decision

Retention: whether identity documents should be archived automatically N months after checkout, and whether archived R2 objects should then be deleted. Replaced (previously rejected) objects are currently archived in D1 and left in R2 until that policy is set.
