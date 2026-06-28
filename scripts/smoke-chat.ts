// Dev smoke: live chat tool-calling loop (DeepSeek) — create a todo + recall memory.
// Usage: bun scripts/smoke-chat.ts
import { generateText, stepCountIs } from "ai";
import { makeDb } from "../server/db/client";
import { truncateAll } from "../server/db/test-helpers";
import { seedDefaultProjects } from "../server/db/seed";
import { createMemory } from "../server/db/queries/memory";
import { listUnscheduledTodos } from "../server/db/queries/items";
import { makeModel } from "../server/ai/model";
import { makeChatTools } from "../server/ai/chat-tools";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL not set");
const db = makeDb(url);
await truncateAll(db);
await seedDefaultProjects(db);
await createMemory(db, { content: "Hates meetings after 4pm", source: "manual" });

const tools = makeChatTools(db);
const res = await generateText({
  model: makeModel(),
  tools,
  stopWhen: stepCountIs(6),
  system: "You are Braindump's assistant. Use the tools to act. Be concise.",
  prompt:
    "Add a todo to email Sam about the Q3 deck. Also, what do you remember about my meeting preferences?",
});

console.log("ASSISTANT:\n" + res.text + "\n");
const toolNames = res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
console.log("tools called:", toolNames.join(", ") || "(none)");

const todos = await listUnscheduledTodos(db);
console.log("\ntodos created:");
for (const t of todos) console.log("  - " + t.title);

const okTodo = todos.some((t) => /sam|deck/i.test(t.title));
const okMemory = /4\s*pm|meeting/i.test(res.text);
console.log(`\ntodo-created=${okTodo}  memory-recalled=${okMemory}`);
if (!okTodo) { console.error("SMOKE FAIL: no todo created via tool"); process.exit(1); }
console.log("SMOKE OK");
process.exit(0);
