import { eq, desc } from "drizzle-orm";
import { type Db } from "../client";
import { activities, todos, events } from "../schema";

export type UndoResult =
  | { undone: true; action: "create"; entityType: string }
  | { undone: false };

export async function undoLastActivity(db: Db): Promise<UndoResult> {
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

  await db.transaction(async (tx) => {
    if (entityType === "todo") {
      await tx.delete(todos).where(eq(todos.id, entityId));
    } else {
      await tx.delete(events).where(eq(events.id, entityId));
    }
    await tx.insert(activities).values({ action: "undo", entityType, entityId });
  });

  return { undone: true, action: "create", entityType };
}
