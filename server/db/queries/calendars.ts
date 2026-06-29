import { eq, asc } from "drizzle-orm";
import { type Db } from "../client";
import { googleCalendar, type GoogleCalendar } from "../schema";

export async function listCalendars(db: Db): Promise<GoogleCalendar[]> {
  return db
    .select()
    .from(googleCalendar)
    .orderBy(asc(googleCalendar.accountId), asc(googleCalendar.summary));
}

export async function setCalendarSelected(
  db: Db,
  id: string,
  selected: boolean,
): Promise<GoogleCalendar | null> {
  const [row] = await db
    .update(googleCalendar)
    .set({ selected })
    .where(eq(googleCalendar.id, id))
    .returning();
  return row ?? null;
}
