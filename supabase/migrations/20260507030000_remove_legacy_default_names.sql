/*
  # Remove legacy default names ("علي هادي علي الرازحي" / "الترف")

  ## Background
  Earlier migrations seeded these strings as DEFAULTs on real columns:
    - account_movements.sender_name  DEFAULT 'علي هادي علي الرازحي'
        (set in 20251227144855_add_sender_beneficiary_fields_to_movements.sql)
    - app_settings.shop_name         DEFAULT 'الترف للحوالات المالية'
    - app_settings.shop_name_en      DEFAULT 'Alatrof Money Transfer'
        (set in 20260330002931_complete_auth_system_setup.sql)

  These were leftover branding from an earlier product. They are not real
  users or customers — just stale defaults that got copied onto every row
  that did not explicitly override them.

  The app now derives sender/beneficiary dynamically from movement_type at
  display time, so the stored values are no longer used by the UI.

  ## What this migration does
  1. Drops the legacy DEFAULTs from the columns.
  2. Nulls (or empties) any existing rows that still hold those exact strings.
  3. Leaves any user-edited values untouched — only exact-match rows are reset.

  ## Reversibility
  This is a one-way clean-up. Take a database backup before running.
*/

BEGIN;

-- ============================================================
-- 1. account_movements.sender_name / beneficiary_name
-- ============================================================

-- Drop the legacy default so future inserts no longer inherit it
ALTER TABLE account_movements ALTER COLUMN sender_name DROP DEFAULT;

-- Null out exact-match rows
UPDATE account_movements
   SET sender_name = NULL
 WHERE sender_name = 'علي هادي علي الرازحي';

-- beneficiary_name had no default, but clean any matching rows defensively
UPDATE account_movements
   SET beneficiary_name = NULL
 WHERE beneficiary_name = 'علي هادي علي الرازحي';

-- ============================================================
-- 2. app_settings.shop_name / shop_name_en
-- ============================================================

-- shop_name is NOT NULL — drop default and reset matches to empty string
ALTER TABLE app_settings ALTER COLUMN shop_name DROP DEFAULT;
UPDATE app_settings
   SET shop_name = ''
 WHERE shop_name = 'الترف للحوالات المالية';

-- shop_name_en is nullable — drop default and reset matches to NULL
ALTER TABLE app_settings ALTER COLUMN shop_name_en DROP DEFAULT;
UPDATE app_settings
   SET shop_name_en = NULL
 WHERE shop_name_en = 'Alatrof Money Transfer';

-- ============================================================
-- 3. Diagnostic — print how many rows were affected
-- ============================================================
DO $$
DECLARE
  v_movements_left int;
  v_settings_left  int;
BEGIN
  SELECT COUNT(*) INTO v_movements_left
    FROM account_movements
   WHERE sender_name = 'علي هادي علي الرازحي'
      OR beneficiary_name = 'علي هادي علي الرازحي';

  SELECT COUNT(*) INTO v_settings_left
    FROM app_settings
   WHERE shop_name = 'الترف للحوالات المالية'
      OR shop_name_en = 'Alatrof Money Transfer';

  RAISE NOTICE 'Cleanup done. Remaining legacy movement rows: %, settings rows: %',
    v_movements_left, v_settings_left;
END $$;

COMMIT;
