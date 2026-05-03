-- Idempotent baseline. The @workspace/db package previously used
-- `drizzle-kit push` (no migrations folder), so existing dev/prod databases
-- already contain these objects. This file is hand-edited to use IF NOT
-- EXISTS / IF NOT EXISTS guards so that running `drizzle-kit migrate` on a
-- brownfield DB is a safe no-op and the meaningful changes live in 0001+.
CREATE TABLE IF NOT EXISTS "projects" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"slug" text NOT NULL,
"description" text,
"metadata" jsonb,
"archived_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_inputs" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"project_id" uuid NOT NULL,
"kind" text NOT NULL,
"title" text,
"raw_text" text NOT NULL,
"metadata" jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generation_runs" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"project_id" uuid NOT NULL,
"source_input_id" uuid,
"status" text NOT NULL,
"model" text,
"prompt_version" text,
"error_message" text,
"metadata" jsonb,
"started_at" timestamp with time zone,
"completed_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_cards" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"project_id" uuid NOT NULL,
"generation_run_id" uuid,
"source_input_id" uuid,
"kind" text NOT NULL,
"title" text,
"content" jsonb NOT NULL,
"previous_content" jsonb,
"previous_updated_at" timestamp with time zone,
"position" integer DEFAULT 0 NOT NULL,
"pinned" boolean DEFAULT false NOT NULL,
"archived_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
"key" text PRIMARY KEY NOT NULL,
"value" jsonb NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rants" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"raw_text" text NOT NULL,
"status" text NOT NULL,
"outputs" jsonb,
"error_message" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "share_links" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"project_id" uuid NOT NULL,
"token" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"revoked_at" timestamp with time zone,
CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_inputs" ADD CONSTRAINT "source_inputs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_source_input_id_source_inputs_id_fk" FOREIGN KEY ("source_input_id") REFERENCES "public"."source_inputs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_cards" ADD CONSTRAINT "asset_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_cards" ADD CONSTRAINT "asset_cards_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_cards" ADD CONSTRAINT "asset_cards_source_input_id_source_inputs_id_fk" FOREIGN KEY ("source_input_id") REFERENCES "public"."source_inputs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_inputs_project_idx" ON "source_inputs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_runs_project_idx" ON "generation_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_runs_source_input_idx" ON "generation_runs" USING btree ("source_input_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_cards_project_idx" ON "asset_cards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_cards_run_idx" ON "asset_cards" USING btree ("generation_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_cards_kind_idx" ON "asset_cards" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_links_project_idx" ON "share_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_links_token_idx" ON "share_links" USING btree ("token");
