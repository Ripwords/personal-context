import type { GoogleCreds } from "../auth/google-credentials";

export type TokenRefresher = (
  refreshToken: string,
) => Promise<{ accessToken: string; expiresAt: number }>;

export async function getFreshAccessToken(
  conn: GoogleCreds,
  now: number,
  refresh: TokenRefresher,
): Promise<string> {
  if (!conn.refreshToken) {
    throw new Error(`no refresh token for account ${conn.accountId}`);
  }
  const { accessToken } = await refresh(conn.refreshToken);
  return accessToken;
}
