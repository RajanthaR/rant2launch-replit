ALTER TABLE "settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rants" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "settings" CASCADE;--> statement-breakpoint
DROP TABLE "rants" CASCADE;--> statement-breakpoint
DROP INDEX "share_links_token_idx";--> statement-breakpoint
CREATE INDEX "source_inputs_project_created_idx" ON "source_inputs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_runs_project_created_idx" ON "generation_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_cards_project_kind_idx" ON "asset_cards" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "share_links_active_idx" ON "share_links" USING btree ("project_id","created_at") WHERE revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "metadata";