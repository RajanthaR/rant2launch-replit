-- Hand-written rollback for migrations 0001_romantic_omega_flight.sql
-- and 0002_thankful_spectrum.sql. drizzle-kit does NOT emit down
-- migrations; this file reverses both. It does NOT restore data in dropped
-- tables (rants/settings) or the dropped projects.metadata column — take a
-- pg_dump backup before applying 0001 in prod.

BEGIN;

-- 1) Drop ALL new indexes added by 0001 / re-created by 0002
DROP INDEX IF EXISTS "share_links_active_idx";
DROP INDEX IF EXISTS "asset_cards_project_kind_idx";
DROP INDEX IF EXISTS "generation_runs_project_created_idx";
DROP INDEX IF EXISTS "source_inputs_project_created_idx";

-- 2) Recreate the redundant share_links_token_idx that 0001 dropped
CREATE INDEX IF NOT EXISTS "share_links_token_idx" ON "share_links" ("token");

-- 3) Re-add the dropped projects.metadata column (data is gone)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- 4) Re-create the dropped tables (data is gone unless restored from backup)
CREATE TABLE IF NOT EXISTS "rants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "raw_text" text NOT NULL,
  "status" text NOT NULL,
  "outputs" jsonb,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 5) Remove the migration markers for 0001 and 0002 by their exact content
--    hashes so drizzle-kit will re-apply them if desired. Targeting hashes
--    (rather than "last 2 rows") makes this safe even if newer, unrelated
--    migrations were added on top.
--    Hashes are sha256 of the migration SQL with `--> statement-breakpoint`
--    splits removed and the remaining statements joined back together —
--    matching drizzle-orm's migrator hashing.
--      0001_romantic_omega_flight.sql:
--        e1a9feb1621cc0b84309e4a2a9925b34db8b4bc21359efd75ca135caaf332f92
--      0002_thankful_spectrum.sql:
--        38ef2c274928cd752b74814182f4dee48d48dbda59b8421ca4776cb37651db86
--    If either file is edited after this rollback ships, recompute via the
--    helper in .local/tasks/db-production-migration.md (Path B bootstrap).
DELETE FROM "drizzle"."__drizzle_migrations"
  WHERE hash IN (
    'e1a9feb1621cc0b84309e4a2a9925b34db8b4bc21359efd75ca135caaf332f92',
    '38ef2c274928cd752b74814182f4dee48d48dbda59b8421ca4776cb37651db86'
  );

COMMIT;
