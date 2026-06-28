CREATE TYPE "public"."event_sync_status" AS ENUM('local', 'synced', 'error');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('work', 'part_time', 'freelance', 'hackathon', 'personal', 'other');--> statement-breakpoint
CREATE TYPE "public"."todo_status" AS ENUM('open', 'done', 'dropped');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dumps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"project_id" uuid,
	"google_event_id" text,
	"google_account_id" text,
	"dump_id" uuid,
	"sync_status" "event_sync_status" DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"kind" "project_kind" NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"project_id" uuid,
	"status" "todo_status" DEFAULT 'open' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"dump_id" uuid,
	"source" "item_source" DEFAULT 'manual' NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_dump_id_dumps_id_fk" FOREIGN KEY ("dump_id") REFERENCES "public"."dumps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_dump_id_dumps_id_fk" FOREIGN KEY ("dump_id") REFERENCES "public"."dumps"("id") ON DELETE no action ON UPDATE no action;