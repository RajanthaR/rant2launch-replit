DROP INDEX "source_inputs_project_created_idx";--> statement-breakpoint
DROP INDEX "generation_runs_project_created_idx";--> statement-breakpoint
DROP INDEX "share_links_active_idx";--> statement-breakpoint
CREATE INDEX "source_inputs_project_created_idx" ON "source_inputs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "generation_runs_project_created_idx" ON "generation_runs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "share_links_active_idx" ON "share_links" USING btree ("project_id","created_at" DESC NULLS LAST) WHERE revoked_at IS NULL;