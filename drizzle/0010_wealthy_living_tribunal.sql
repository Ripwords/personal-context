ALTER TABLE "todos" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "google_account_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "calendar_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "sync_status" "event_sync_status" DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "todos_google_identity" ON "todos" USING btree ("google_account_id","google_event_id");