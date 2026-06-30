import { eq, desc } from "drizzle-orm";
import { type Db } from "../client";
import { activities, todos, events } from "../schema";
import { isAuthError } from "../../calendar-sync/google-rest";
import type { DeleteFromGoogleFn, GoogleSync } from "../../calendar-sync/mutations";

export type UndoResult =
  | { undone: true; action: "create"; entityType: string; googleSync: GoogleSync }
  | { undone: false };

export interface UndoDeps {
  deleteFromGoogle?: DeleteFromGoogleFn;
}

type GoogleIdentity = { accountId: string; calendarId: string; eventId: string };

function googleIdentityOf(row: {
  googleEventId: string | null;
  googleAccountId: string | null;
  calendarId: string | null;
}): GoogleIdentity | null {
  if (!row.googleEventId || !row.googleAccountId || !row.calendarId) return null;
  return { accountId: row.googleAccountId, calendarId: row.calendarId, eventId: row.googleEventId };
}

export async function undoLastActivity(db: Db, deps: UndoDeps = {}): Promise<UndoResult> {
  // Load recent activities (create + undo) to find the latest undoable create.
  const rows = await db
    .select()
    .from(activities)
    .orderBy(desc(activities.createdAt))
    .limit(200);

  // Collect entityIds that have already been undone.
  const undoneIds = new Set<string>(
    rows.filter((r) => r.action === "undo").map((r) => r.entityId),
  );

  // Find the most recent create activity whose entity hasn't been undone yet.
  const target = rows.find(
    (r) => r.action === "create" && !undoneIds.has(r.entityId),
  );

  if (!target) {
    return { undone: false };
  }

  const { entityType, entityId } = target;

  if (entityType !== "todo" && entityType !== "event") {
    return { undone: false };
  }

  // Resolve the row first so we can mirror the deletion to Google before tombstoning.
  const [row] =
    entityType === "event"
      ? await db.select().from(events).where(eq(events.id, entityId)).limit(1)
      : await db.select().from(todos).where(eq(todos.id, entityId)).limit(1);

  // Best-effort Google deletion: undo is local-source-of-truth, so we remove
  // locally regardless, and report googleSync so the UI can warn on failure.
  const ident = row ? googleIdentityOf(row) : null;
  let googleSync: GoogleSync = "off";
  if (ident) {
    if (!deps.deleteFromGoogle) {
      googleSync = "not-synced";
    } else {
      try {
        await deps.deleteFromGoogle(ident);
        googleSync = "synced";
      } catch (err) {
        googleSync = isAuthError(err) ? "needs-reauth" : "not-synced";
      }
    }
  }

  await db.transaction(async (tx) => {
    if (entityType === "todo") {
      await tx.delete(todos).where(eq(todos.id, entityId));
    } else {
      await tx.delete(events).where(eq(events.id, entityId));
    }
    await tx.insert(activities).values({ action: "undo", entityType, entityId });
  });

  return { undone: true, action: "create", entityType, googleSync };
}
