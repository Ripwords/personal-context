import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { createTodo, createEvent } from "../db/queries/items";
import { resolveWritebackItems, writeBraindumpItems } from "./writeback";
import { events as eventsTable, todos as todosTable } from "../db/schema";
import { eq } from "drizzle-orm";
import type { GoogleCreds } from "../auth/google-credentials";
import type { CalendarApi } from "./braindump-calendar";
import { type EventWriteApi, GoogleApiError } from "./google-rest";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
  // Seed an account so ensureBraindumpCalendar can upsert a connection row (FK).
  await db.execute(sql`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1','Test','test@example.com',false)`);
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id) VALUES ('acc1','g1','google','u1')`);
});

test("resolveWritebackItems includes only events — todos are reminders, never mirrored", async () => {
  const ev = await createEvent(db, {
    title: "Standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
  });
  // A timed todo is now a REMINDER (notification), not a calendar mirror.
  const reminder = await createTodo(db, {
    title: "Check project",
    scheduledStart: new Date("2026-07-01T14:00:00Z"),
  });
  const anytime = await createTodo(db, { title: "Buy milk" });

  const items = await resolveWritebackItems(db, [
    { kind: "event", id: ev.id },
    { kind: "todo", id: reminder.id },
    { kind: "todo", id: anytime.id },
  ]);

  expect(items.map((i) => i.title)).toEqual(["Standup"]); // both todos skipped
  expect(items.every((i) => i.kind === "event")).toBe(true);
  expect(items.find((i) => i.kind === "event")!.startsAt.toISOString()).toBe("2026-07-01T09:00:00.000Z");
});

test("writeBraindumpItems provisions the calendar, writes each item, and stamps event rows", async () => {
  const ev = await createEvent(db, {
    title: "Standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
  });
  const conn: GoogleCreds = {
    accountId: "acc1", role: "personal", accessToken: "at", refreshToken: "rt", braindumpCalendarId: null,
  };
  let createdCalendar = "";
  const calApi: CalendarApi = {
    insert: async ({ summary }) => { createdCalendar = summary; return { id: "braindump-cal-1" }; },
  };
  const writes: string[] = [];
  const eventWriteApi: EventWriteApi = {
    insert: async ({ calendarId, summary }) => { writes.push(`${calendarId}:${summary}`); return { id: `g-${summary}` }; },
  };

  const res = await writeBraindumpItems(db, conn, calApi, eventWriteApi,
    [{ kind: "event", id: ev.id, title: "Standup", startsAt: ev.startsAt, endsAt: ev.endsAt }]);

  expect(res.written).toBe(1);
  expect(res.needsReauth).toBe(false);
  expect(createdCalendar).toBe("Braindump");
  expect(writes).toEqual(["braindump-cal-1:Standup"]);

  const [row] = await db.select().from(eventsTable).where(eq(eventsTable.id, ev.id));
  expect(row!.googleEventId).toBe("g-Standup");
  expect(row!.calendarId).toBe("braindump-cal-1");
  expect(row!.syncStatus).toBe("synced");
});

test("writeBraindumpItems stamps scheduled todo rows with Google identity too", async () => {
  const todo = await createTodo(db, {
    title: "Check project",
    scheduledStart: new Date("2026-07-01T14:00:00Z"),
    scheduledEnd: new Date("2026-07-01T14:30:00Z"),
  });
  const conn: GoogleCreds = {
    accountId: "acc1", role: "personal", accessToken: "at", refreshToken: "rt", braindumpCalendarId: null,
  };
  const calApi: CalendarApi = {
    insert: async () => ({ id: "braindump-cal-1" }),
  };
  const eventWriteApi: EventWriteApi = {
    insert: async ({ summary }) => ({ id: `g-${summary}` }),
  };

  await writeBraindumpItems(db, conn, calApi, eventWriteApi,
    [{ kind: "todo", id: todo.id, title: todo.title, startsAt: todo.scheduledStart!, endsAt: todo.scheduledEnd! }]);

  const [row] = await db.select().from(todosTable).where(eq(todosTable.id, todo.id));
  expect(row!.googleEventId).toBe("g-Check project");
  expect(row!.calendarId).toBe("braindump-cal-1");
  expect(row!.syncStatus).toBe("synced");
});

test("writeBraindumpItems reports needsReauth when calendar creation is forbidden (403)", async () => {
  const ev = await createEvent(db, {
    title: "Standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
  });
  const conn: GoogleCreds = {
    accountId: "acc1", role: "personal", accessToken: "at", refreshToken: "rt", braindumpCalendarId: null,
  };
  const calApi: CalendarApi = {
    insert: async () => { throw new GoogleApiError(403, "create calendar failed: 403"); },
  };
  const eventWriteApi: EventWriteApi = { insert: async () => ({ id: "x" }) };

  const res = await writeBraindumpItems(db, conn, calApi, eventWriteApi,
    [{ kind: "event", id: ev.id, title: "Standup", startsAt: ev.startsAt, endsAt: ev.endsAt }]);

  expect(res.written).toBe(0);
  expect(res.needsReauth).toBe(true);
});
