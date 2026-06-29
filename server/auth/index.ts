import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "../db/client";
import * as schema from "../db/schema";

const db = getDb();

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      scope: [
        "openid",
        "email",
        "profile",
        // Full calendar scope: read events/calendarList AND create the dedicated
        // "Braindump" calendar + write AI events back. (calendar.events alone
        // cannot create a calendar — returns 403.)
        "https://www.googleapis.com/auth/calendar",
      ],
      accessType: "offline",
      prompt: "consent",
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      // Personal + work Google accounts have different emails by design,
      // so linking must not require the emails to match.
      allowDifferentEmails: true,
    },
  },
});
