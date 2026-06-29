import type { TokenRefresher } from "./access-token";
import type { CalendarListApi, EventsApi, RawGoogleCalendar, RawGoogleEvent } from "./sync-events";

export function makeGoogleTokenRefresher(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch,
): TokenRefresher {
  return async (refreshToken: string) => {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  };
}

export function makeGoogleEventsApi(fetchImpl: typeof fetch = fetch): EventsApi {
  return {
    async list({ accessToken, calendarId, timeMin, timeMax }) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`calendar list failed: ${res.status}`);
      const json = (await res.json()) as { items?: RawGoogleEvent[] };
      return json.items ?? [];
    },
  };
}

export function makeGoogleCalendarListApi(fetchImpl: typeof fetch = fetch): CalendarListApi {
  return {
    async list({ accessToken }) {
      const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader";
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`calendarList failed: ${res.status}`);
      const json = (await res.json()) as { items?: RawGoogleCalendar[] };
      return json.items ?? [];
    },
  };
}
