CREATE TABLE "google_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"summary" text NOT NULL,
	"background_color" text,
	"foreground_color" text,
	"selected" boolean DEFAULT true NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "calendar_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_identity" ON "google_calendar" USING btree ("account_id","calendar_id");