// server/auth/connections.ts
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
  // Upsert: an account may not have a google_connections row yet (role defaults
  // to "personal" via LEFT JOIN), so insert one rather than failing the update.
  const [row] = await db
    .insert(googleConnections)
    .values({ accountId, role: "personal", braindumpCalendarId: calendarId })
    .onConflictDoUpdate({
      target: googleConnections.accountId,
      set: { braindumpCalendarId: calendarId },
    })
    .returning();
  return row!;
}

export async function listConnections(db: Db): Promise<GoogleConnection[]> {
  return db.select().from(googleConnections);
}
