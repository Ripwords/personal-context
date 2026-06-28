CREATE TYPE "public"."memory_source" AS ENUM('dump', 'chat', 'manual');--> statement-breakpoint
CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"source" "memory_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;--> statement-breakpoint
CREATE INDEX "memory_search_idx" ON "memory" USING gin ("search");
