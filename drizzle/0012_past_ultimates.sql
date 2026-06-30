ALTER TABLE "todos" ADD COLUMN "remind_at" timestamp with time zone;
--> statement-breakpoint
-- Data migration: `scheduled_start` previously held the REMINDER time. Now it
-- means calendar-block scheduling, so move existing values into `remind_at` and
-- clear the (then-overloaded) scheduling columns. No real calendar blocks exist
-- yet, so this is a lossless reinterpretation.
UPDATE "todos" SET "remind_at" = "scheduled_start" WHERE "scheduled_start" IS NOT NULL;
--> statement-breakpoint
UPDATE "todos" SET "scheduled_start" = NULL, "scheduled_end" = NULL WHERE "remind_at" IS NOT NULL;
