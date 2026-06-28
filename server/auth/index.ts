import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { makeDb } from "../db/client";
import * as schema from "../db/schema";

const db = makeDb(process.env.NUXT_DATABASE_URL ?? "");

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
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      accessType: "offline",
      prompt: "consent",
    },
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
});
