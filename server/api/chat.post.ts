import { defineEventHandler, createError, readBody, setResponseHeader } from "h3";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  stepCountIs,
  type UIMessage,
} from "ai";
import { getDb } from "../db/client";
import { getAuthSession } from "../utils/session";
import { makeModel } from "../ai/model";
import { makeChatTools } from "../ai/chat-tools";
import { getGoogleConnections } from "../auth/google-credentials";
import { getFreshAccessToken } from "../calendar-sync/access-token";
import { makeGoogleTokenRefresher, makeGoogleCalendarApi, makeGoogleEventWriteApi, makeGoogleEventDeleteApi, makeGoogleEventPatchApi } from "../calendar-sync/google-rest";
import { makeBraindumpMirror, type WritebackItem } from "../calendar-sync/writeback";
import { searchMemories } from "../db/queries/memory";
import { listProjects } from "../db/queries/projects";
import { createChatSession, addChatMessage } from "../db/queries/chats";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  interface ChatRequest {
    messages?: UIMessage[];
    sessionId?: string;
    timeZone?: string;
    /** Calendar copilot: stream without persisting the session or its messages. */
    ephemeral?: boolean;
  }

  const body = await readBody<ChatRequest>(event);
  const messages: UIMessage[] = body.messages ?? [];
  const ephemeral = body.ephemeral === true;

  const db = getDb();

  // The copilot is ephemeral — skip all DB persistence so its quick exchanges
  // never create sessions or clutter the /chat history.
  const sessionId = ephemeral
    ? null
    : (body.sessionId ?? (await createChatSession(db)).id);
  if (sessionId) setResponseHeader(event, "x-chat-session-id", sessionId);

  // Memory recall: find latest user message text for FTS search
  const latestUserMsg = [...messages]
    .reverse()
    .find((m) => m.role === "user");

  const latestUserText = latestUserMsg?.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ") ?? "";

  if (latestUserMsg && sessionId) {
    await addChatMessage(db, {
      sessionId,
      role: "user",
      content: latestUserText,
    });
  }

  const [memories, projects] = await Promise.all([
    latestUserText ? searchMemories(db, latestUserText, 5) : Promise.resolve([]),
    listProjects(db),
  ]);

  // Prefer the client's timezone so "today"/"tomorrow"/"2pm" resolve to the
  // user's local day — the server (e.g. Vercel) runs in UTC.
  const now = new Date();
  const tz = body.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const datetime = now.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const memoriesBlock =
    memories.length > 0
      ? `\nRelevant things you remember about the user:\n${memories.map((m) => `- ${m.content}`).join("\n")}`
      : "";

  const projectsBlock =
    projects.length > 0
      ? `\nProjects: ${projects.map((p) => p.name).join(", ")}`
      : "";

  const system = [
    `You are a personal assistant integrated into the user's Braindump app.`,
    `Today is ${datetime} (${tz}). Resolve relative dates and times ("today", "tomorrow", "tonight", "2pm", "next Monday") against this.`,
    memoriesBlock,
    projectsBlock,
    `\nTool guidance:`,
    `- Do not create, delete, or update items unless the user clearly asks for that action.`,
    `- There are THREE kinds of item — choose deliberately:`,
    `  • EVENT (create_event): a calendar block — a meeting, appointment, call, or anything involving other people, a place, or a span of time ("meeting with Anin at 10", "lunch 1–2pm", "dentist Friday 3pm"). Events go on the calendar and sync to Google.`,
    `  • REMINDER (create_todo with remindAt): a personal nudge the user wants to be notified about at a time ("remind me to take meds at 8", "ping me to call the dentist at 2", "remind me about the deadline at 5pm"). A reminder fires a browser notification and is NOT placed on the calendar.`,
    `  • PLAIN TODO (create_todo, no remindAt): a task with no specific time ("add buy milk to my todos"). A casually-mentioned rough day/time goes in notes, not remindAt.`,
    `- Differentiate event vs reminder yourself from the wording. Only when it is genuinely ambiguous which one the user means, ask ONE short clarifying question before creating — otherwise just act.`,
    `- Never ask for a time you don't need. If a plain todo was requested, create it and confirm in one turn — do not solicit a time.`,
    `- create_event needs a clear date and start time (or enough to infer both confidently). If those are missing for something that really is an event, ask for them instead of guessing.`,
    `- Create each item exactly once. Never call create_event/create_todo twice for the same item — one mention of "lunch at 1pm" is ONE event.`,
    `- Event endsAt must be after startsAt. Use a normal duration (30-60 minutes) when the user gives a start time but no end time.`,
    `- Before deleting/updating a calendar item, use read_calendar for the relevant range when the user gives a date/time; prefer the id+kind from read_calendar when calling delete_event/update_event.`,
    `- To remove, cancel, delete, or drop an existing calendar item, use delete_event. NEVER create an event to represent a deletion. If delete_event reports multiple matches, ask the user which one; if none, say so.`,
    `- To move, reschedule, rename, or change an existing calendar item, use update_event. Never create a duplicate to represent an edit.`,
    `- If a calendar mutation reports needs-reauth or not-synced, tell the user the change was not applied and they may need to reconnect Google or retry.`,
    `- Use search_memory / search_documents before answering from memory.`,
    `- Use web_search for current or external information.`,
    `- Use read_calendar to check the user's schedule.`,
  ]
    .filter(Boolean)
    .join("\n");

  const modelMessages = await convertToModelMessages(messages);

  const refresher = makeGoogleTokenRefresher(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
  );

  // Per-account fresh access token, resolved at most once each.
  const tokenByAccount = new Map<string, Promise<string>>();
  async function tokenFor(conn: { accountId: string }): Promise<string> {
    let p = tokenByAccount.get(conn.accountId);
    if (!p) {
      p = (async () => {
        const conns = await getGoogleConnections(db);
        const full = conns.find((c) => c.accountId === conn.accountId);
        if (!full) throw new Error(`no connection for ${conn.accountId}`);
        return getFreshAccessToken(full, Date.now(), refresher);
      })();
      tokenByAccount.set(conn.accountId, p);
    }
    return p;
  }

  // Lazily resolve the Braindump mirror: the connection + access token are only
  // fetched the first time the assistant actually creates an event/timed todo.
  let mirrorPromise: Promise<((item: WritebackItem) => Promise<void>) | null> | null = null;
  const mirror = (item: WritebackItem) =>
    (mirrorPromise ??= (async () => {
      const conns = await getGoogleConnections(db);
      const target = conns.find((c) => c.role === "personal") ?? conns[0];
      if (!target) return null;
      const at = await tokenFor(target);
      return makeBraindumpMirror(db, target, makeGoogleCalendarApi(at), makeGoogleEventWriteApi(at), body.timeZone);
    })()).then((m) => (m ? m(item) : undefined));

  // Delete an event from the calendar/account it actually lives in.
  const deleteFromGoogle = async (input: { accountId: string; calendarId: string; eventId: string }) => {
    const at = await tokenFor({ accountId: input.accountId });
    await makeGoogleEventDeleteApi(at).remove({ calendarId: input.calendarId, eventId: input.eventId });
  };

  // Patch an event in the calendar/account it actually lives in.
  const updateInGoogle = async (input: {
    accountId: string; calendarId: string; eventId: string; title?: string; startsAt?: Date; endsAt?: Date;
  }) => {
    const at = await tokenFor({ accountId: input.accountId });
    await makeGoogleEventPatchApi(at).patch({
      calendarId: input.calendarId,
      eventId: input.eventId,
      summary: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timeZone: body.timeZone,
    });
  };

  const result = streamText({
    model: makeModel(),
    system,
    messages: modelMessages,
    tools: makeChatTools(db, process.env, { mirror, deleteFromGoogle, updateInGoogle }),
    stopWhen: stepCountIs(8),
    onFinish: async ({ text }) => {
      if (!sessionId) return; // ephemeral copilot — nothing to persist
      await addChatMessage(db, {
        sessionId,
        role: "assistant",
        content: text,
        parts: undefined,
      });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});
