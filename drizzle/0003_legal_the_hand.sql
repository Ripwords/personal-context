CREATE TYPE "public"."connection_role" AS ENUM('personal', 'work');--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"role" "connection_role" NOT NULL,
	"braindump_calendar_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_connections_account_id_unique" UNIQUE("account_id")
);--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
