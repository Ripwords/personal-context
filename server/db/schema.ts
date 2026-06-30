import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  real,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── App enums ──────────────────────────────────────────────────────────────

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
export const memorySource = pgEnum("memory_source", ["dump", "chat", "manual"]);

// ── App tables ─────────────────────────────────────────────────────────────

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
  // For a todo, `scheduledStart` is its REMINDER time (notify-at) — NOT a
  // calendar slot. A todo with scheduledStart set is a "reminder": it fires a
  // browser notification at that time and is never gridded or synced to Google.
  // (Events own the calendar; reminders own notifications.) `scheduledEnd` is
  // unused for reminders (a reminder is a point in time).
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
  // Set when this reminder's browser notification has fired, so it never
  // double-fires across reloads/tabs. Cleared when the reminder time changes.
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  dumpId: uuid("dump_id").references(() => dumps.id),
  source: itemSource("source").notNull().default("manual"),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // A scheduled todo that has been mirrored to Google carries the same identity
  // triple as an event row, so it can later be patched/deleted on Google.
  googleEventId: text("google_event_id"),
  googleAccountId: text("google_account_id"),
  calendarId: text("calendar_id"),
  syncStatus: eventSyncStatus("sync_status").notNull().default("local"),
}, (t) => ({
  googleIdentity: uniqueIndex("todos_google_identity").on(t.googleAccountId, t.googleEventId),
}));

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  projectId: uuid("project_id").references(() => projects.id),
  googleEventId: text("google_event_id"),
  googleAccountId: text("google_account_id"),
  // Which Google calendar this event came from (id within the account). Joins to
  // google_calendar (googleAccountId, calendarId) for the calendar's display color.
  calendarId: text("calendar_id"),
  allDay: boolean("all_day").notNull().default(false),
  dumpId: uuid("dump_id").references(() => dumps.id),
  syncStatus: eventSyncStatus("sync_status").notNull().default("local"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  googleIdentity: uniqueIndex("events_google_identity").on(t.googleAccountId, t.googleEventId),
}));

// One row per Google calendar within a connected account. Carries the calendar's
// display color (from calendarList) and the user's show/hide toggle (`selected`).
export const googleCalendar = pgTable("google_calendar", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  calendarId: text("calendar_id").notNull(),
  summary: text("summary").notNull(),
  backgroundColor: text("background_color"),
  foregroundColor: text("foreground_color"),
  selected: boolean("selected").notNull().default(true),
  primary: boolean("primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  identity: uniqueIndex("google_calendar_identity").on(t.accountId, t.calendarId),
}));

export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  content: text("content").notNull(),
  source: memorySource("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Document RAG tables ────────────────────────────────────────────────────

export const document = pgTable("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentChunk = pgTable("document_chunk", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => document.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  // NOTE: "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED
  // is hand-added to the generated migration (NOT tracked by Drizzle — it's DB-managed).
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type DocumentChunk = typeof documentChunk.$inferSelect;
export type NewDocumentChunk = typeof documentChunk.$inferInsert;

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── App types ──────────────────────────────────────────────────────────────

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Dump = typeof dumps.$inferSelect;
export type NewDump = typeof dumps.$inferInsert;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type GoogleCalendar = typeof googleCalendar.$inferSelect;
export type NewGoogleCalendar = typeof googleCalendar.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Memory = typeof memory.$inferSelect;
export type NewMemory = typeof memory.$inferInsert;

// ── Chat tables ────────────────────────────────────────────────────────────

export const chatSession = pgTable("chat_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New chat"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessage = pgTable("chat_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => chatSession.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  parts: jsonb("parts"), // nullable — stores tool parts / structured parts
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChatSession = typeof chatSession.$inferSelect;
export type NewChatSession = typeof chatSession.$inferInsert;
export type ChatMessage = typeof chatMessage.$inferSelect;
export type NewChatMessage = typeof chatMessage.$inferInsert;

// ── Better Auth tables ─────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ── Google connection tables ───────────────────────────────────────────────

export const connectionRole = pgEnum("connection_role", ["personal", "work"]);

export const googleConnections = pgTable("google_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull().unique().references(() => account.id, { onDelete: "cascade" }),
  role: connectionRole("role").notNull(),
  braindumpCalendarId: text("braindump_calendar_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoogleConnection = typeof googleConnections.$inferSelect;
export type NewGoogleConnection = typeof googleConnections.$inferInsert;

// ── Better Auth relations ──────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
