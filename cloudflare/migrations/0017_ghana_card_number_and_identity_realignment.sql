PRAGMA foreign_keys = ON;

-- Stage 2L-F-R: Institution/Other identity realignment.
-- Migrations 0001–0016 remain immutable (especially 0016).
--
-- Ghana Card NUMBER is sensitive identity data and must NOT be stored in
-- residents.student_id. The existing documents.ghana_card type stores the
-- DOCUMENT only; no separate number column existed before this migration.
--
-- Other residents use institution_id/student_id NULL (no fake institution row)
-- with ghana_card_number as the contextual identifier.
-- resident_kind remains as an internal derived classification
-- (listed institution → student, Other → non_student) and is not a separate
-- resident-facing workflow.

ALTER TABLE residents ADD COLUMN ghana_card_number TEXT;

-- Uniqueness when present (Other path).
CREATE UNIQUE INDEX idx_residents_ghana_card_number_unique
  ON residents(ghana_card_number)
  WHERE ghana_card_number IS NOT NULL;

-- Helpful lookup for Other residents (kind already indexed in 0016).
CREATE INDEX idx_residents_ghana_card_number
  ON residents(ghana_card_number)
  WHERE ghana_card_number IS NOT NULL;
