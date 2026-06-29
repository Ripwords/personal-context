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
import { makeGoogleTokenRefresher, makeGoogleCalendarApi, makeGoogleEventWriteApi } from "../calendar-sync/google-rest";
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
  }

  const body = await readBody<ChatRequest>(event);
  const messages: UIMessage[] = body.messages ?? [];

  const db = getDb();

  const sessionId = body.sessionId ?? (await createChatSession(db)).id;
  setResponseHeader(event, "x-chat-session-id", sessionId);

  // Memory recall: find latest user message text for FTS search
  const latestUserMsg = [...messages]
    .reverse()
    .find((m) => m.role === "user");

  const latestUserText = latestUserMsg?.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ") ?? "";

  if (latestUserMsg) {
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
    `- Use create_todo / create_event to capture tasks and events the user mentions.`,
    `- Use search_memory / search_documents before answering from memory.`,
    `- Use web_search for current or external information.`,
    `- Use read_calendar to check the user's schedule.`,
  ]
    .filter(Boolean)
    .join("\n");

  const modelMessages = await convertToModelMessages(messages);

  // Lazily resolve the Braindump mirror: the connection + access token are only
  // fetched the first time the assistant actually creates an event/timed todo.
  let mirrorPromise: Promise<((item: WritebackItem) => Promise<void>) | null> | null = null;
  const mirror = (item: WritebackItem) =>
    (mirrorPromise ??= (async () => {
      const conns = await getGoogleConnections(db);
      const target = conns.find((c) => c.role === "personal") ?? conns[0];
      if (!target) return null;
      const refresh = makeGoogleTokenRefresher(
        process.env.GOOGLE_CLIENT_ID ?? "",
        process.env.GOOGLE_CLIENT_SECRET ?? "",
      );
      const at = await getFreshAccessToken(target, Date.now(), refresh);
      return makeBraindumpMirror(db, target, makeGoogleCalendarApi(at), makeGoogleEventWriteApi(at), body.timeZone);
    })()).then((m) => (m ? m(item) : undefined));

  const result = streamText({
    model: makeModel(),
    system,
    messages: modelMessages,
    tools: makeChatTools(db, process.env, mirror),
    stopWhen: stepCountIs(8),
    onFinish: async ({ text }) => {
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
