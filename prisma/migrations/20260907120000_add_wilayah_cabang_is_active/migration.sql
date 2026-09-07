-- Adds an active/inactive flag to Wilayah and Cabang so admins can mark
-- test or decommissioned regions/branches without deleting them, and have
-- them excluded from dropdowns, filters, and dashboard/report aggregates.
-- Defaults to true so every existing row stays visible after migrating.
ALTER TABLE "core"."wilayah" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "core"."cabang" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
