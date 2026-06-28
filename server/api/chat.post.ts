import { defineEventHandler, createError, readBody } from "h3";
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
import { searchMemories } from "../db/queries/memory";
import { listProjects } from "../db/queries/projects";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  interface ChatRequest {
    messages?: UIMessage[];
  }

  const body = await readBody<ChatRequest>(event);
  const messages: UIMessage[] = body.messages ?? [];

  const db = getDb();

  // Memory recall: find latest user message text for FTS search
  const latestUserText = [...messages]
    .reverse()
    .find((m) => m.role === "user")
    ?.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ") ?? "";

  const [memories, projects] = await Promise.all([
    latestUserText ? searchMemories(db, latestUserText, 5) : Promise.resolve([]),
    listProjects(db),
  ]);

  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const datetime = now.toISOString();

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
    `Current datetime: ${datetime} (${tz})`,
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

  const result = streamText({
    model: makeModel(),
    system,
    messages: modelMessages,
    tools: makeChatTools(db),
    stopWhen: stepCountIs(8),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});
