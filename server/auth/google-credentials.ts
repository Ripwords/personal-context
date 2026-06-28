// server/auth/google-credentials.ts
import { eq } from "drizzle-orm";
import { type Db } from "../db/client";
import { account, googleConnections } from "../db/schema";

export type GoogleCreds = {
  accountId: string;
  role: "personal" | "work";
  accessToken: string;
  refreshToken: string | null;
  braindumpCalendarId: string | null;
};

export async function getGoogleConnections(db: Db): Promise<GoogleCreds[]> {
  const rows = await db
    .select({
      accountId: account.id,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      role: googleConnections.role,
      braindumpCalendarId: googleConnections.braindumpCalendarId,
    })
    .from(account)
    .innerJoin(googleConnections, eq(googleConnections.accountId, account.id))
    .where(eq(account.providerId, "google"));

  return rows.map((r) => ({
    accountId: r.accountId,
    role: r.role,
    accessToken: r.accessToken ?? "",
    refreshToken: r.refreshToken ?? null,
    braindumpCalendarId: r.braindumpCalendarId ?? null,
  }));
}
