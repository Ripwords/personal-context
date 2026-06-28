// server/db/schema.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  real,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const projectKind = pgEnum("project_kind", [
  "work",
  "part_time",
  "freelance",
  "hackathon",
  "personal",
  "other",
]);
export const todoStatus = pgEnum("todo_status", ["open", "done", "dropped"]);
export const eventSyncStatus = pgEnum("event_sync_status", [
  "local",
  "synced",
  "error",
]);
export const itemSource = pgEnum("item_source", ["ai", "manual"]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  kind: projectKind("kind").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dumps = pgTable("dumps", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  notes: text("notes"),
  projectId: uuid("project_id").references(() => projects.id),
  status: todoStatus("status").notNull().default("open"),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
  dumpId: uuid("dump_id").references(() => dumps.id),
  source: itemSource("source").notNull().default("manual"),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  projectId: uuid("project_id").references(() => projects.id),
  googleEventId: text("google_event_id"),
  googleAccountId: text("google_account_id"),
  dumpId: uuid("dump_id").references(() => dumps.id),
  syncStatus: eventSyncStatus("sync_status").notNull().default("local"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Dump = typeof dumps.$inferSelect;
export type NewDump = typeof dumps.$inferInsert;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
