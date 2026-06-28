// server/auth/connections.ts
import { eq } from "drizzle-orm";
import { type Db } from "../db/client";
import { googleConnections, type GoogleConnection } from "../db/schema";

export async function setConnectionRole(
  db: Db,
  accountId: string,
  role: "personal" | "work",
): Promise<GoogleConnection> {
  const [row] = await db
    .insert(googleConnections)
    .values({ accountId, role })
    .onConflictDoUpdate({ target: googleConnections.accountId, set: { role } })
    .returning();
  return row!;
}

export async function setBraindumpCalendarId(
  db: Db,
  accountId: string,
  calendarId: string,
): Promise<GoogleConnection> {
  const [row] = await db
    .update(googleConnections)
    .set({ braindumpCalendarId: calendarId })
    .where(eq(googleConnections.accountId, accountId))
    .returning();
  if (!row) throw new Error(`No google_connections row for accountId ${accountId}`);
  return row;
}

export async function listConnections(db: Db): Promise<GoogleConnection[]> {
  return db.select().from(googleConnections);
}
