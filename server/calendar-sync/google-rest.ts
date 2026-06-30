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

export type UserInfoApi = {
  email(input: { accessToken: string }): Promise<string | null>;
};

// ── Write APIs (calendar provisioning + event creation) ─────────────────────

/** Error carrying the Google HTTP status so callers can detect auth/scope failures. */
export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** True for errors that mean "the user must re-consent" (missing/expired scope). */
export function isAuthError(err: unknown): boolean {
  return err instanceof GoogleApiError && (err.status === 401 || err.status === 403);
}

/** Create the "Braindump" calendar. Bound to an account's access token. */
export function makeGoogleCalendarApi(accessToken: string, fetchImpl: typeof fetch = fetch) {
  return {
    async insert({ summary }: { summary: string }): Promise<{ id: string }> {
      const res = await fetchImpl("https://www.googleapis.com/calendar/v3/calendars", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new GoogleApiError(res.status, `create calendar failed: ${res.status}`);
      const json = (await res.json()) as { id: string };
      return { id: json.id };
    },
    async list(): Promise<{ id: string; summary: string }[]> {
      const res = await fetchImpl(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner&showHidden=true",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new GoogleApiError(res.status, `calendarList failed: ${res.status}`);
      const json = (await res.json()) as { items?: { id: string; summary?: string }[] };
      return (json.items ?? []).map((c) => ({ id: c.id, summary: c.summary ?? "" }));
    },
  };
}

export type EventWriteApi = {
  insert(input: {
    calendarId: string;
    summary: string;
    startsAt: Date;
    endsAt: Date;
    timeZone?: string;
  }): Promise<{ id: string }>;
};

export type EventPatchApi = {
  patch(input: {
    calendarId: string;
    eventId: string;
    summary?: string;
    startsAt?: Date;
    endsAt?: Date;
    timeZone?: string;
  }): Promise<void>;
};

export function makeGoogleEventPatchApi(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): EventPatchApi {
  return {
    async patch({ calendarId, eventId, summary, startsAt, endsAt, timeZone }) {
      const body: Record<string, unknown> = {};
      if (summary !== undefined) body.summary = summary;
      if (startsAt) body.start = { dateTime: startsAt.toISOString(), ...(timeZone ? { timeZone } : {}) };
      if (endsAt) body.end = { dateTime: endsAt.toISOString(), ...(timeZone ? { timeZone } : {}) };
      if (Object.keys(body).length === 0) return;
      const res = await fetchImpl(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok && res.status !== 410) {
        throw new GoogleApiError(res.status, `patch event failed: ${res.status}`);
      }
    },
  };
}

export type EventDeleteApi = {
  remove(input: { calendarId: string; eventId: string }): Promise<void>;
};

export function makeGoogleEventDeleteApi(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): EventDeleteApi {
  return {
    async remove({ calendarId, eventId }) {
      const res = await fetchImpl(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      );
      // 410 Gone = already deleted; treat as success.
      if (!res.ok && res.status !== 410) {
        throw new GoogleApiError(res.status, `delete event failed: ${res.status}`);
      }
    },
  };
}

export function makeGoogleEventWriteApi(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): EventWriteApi {
  return {
    async insert({ calendarId, summary, startsAt, endsAt, timeZone }) {
      const body = {
        summary,
        start: { dateTime: startsAt.toISOString(), ...(timeZone ? { timeZone } : {}) },
        end: { dateTime: endsAt.toISOString(), ...(timeZone ? { timeZone } : {}) },
      };
      const res = await fetchImpl(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new GoogleApiError(res.status, `create event failed: ${res.status}`);
      const json = (await res.json()) as { id: string };
      return { id: json.id };
    },
  };
}

export function makeGoogleUserInfoApi(fetchImpl: typeof fetch = fetch): UserInfoApi {
  return {
    async email({ accessToken }) {
      const res = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { email?: string };
      return json.email ?? null;
    },
  };
}

export function makeGoogleCalendarListApi(fetchImpl: typeof fetch = fetch): CalendarListApi {
  return {
    async list({ accessToken }) {
      const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=true";
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`calendarList failed: ${res.status}`);
      const json = (await res.json()) as { items?: RawGoogleCalendar[] };
      return json.items ?? [];
    },
  };
}
