// Dev smoke: run the real AI extraction against the test DB + live DeepSeek.
// Usage: bun scripts/smoke-dump.ts   (reads TEST_DATABASE_URL + DEEPSEEK_API_KEY from .env)
import { makeDb } from "../server/db/client";
import { truncateAll } from "../server/db/test-helpers";
import { seedDefaultProjects } from "../server/db/seed";
import { makeModel } from "../server/ai/model";
import { extractFromDump } from "../server/ai/extract";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL not set");
const db = makeDb(url);

await truncateAll(db);
const projects = await seedDefaultProjects(db);
console.log("seeded projects:", projects.map((p) => p.name).join(", "));

const dump =
  "Tomorrow 3pm dentist appointment. Email Sam about the Q3 work deck by Friday. " +
  "Buy groceries this weekend. Prep slides for the hackathon demo on Saturday morning.";

console.log("\nDUMP:\n" + dump + "\n");
const t0 = Date.now();
const res = await extractFromDump(db, makeModel(), dump);
console.log(`extracted ${res.created.length} items in ${Date.now() - t0}ms:\n`);
for (const c of res.created) {
  console.log(
    `  [${c.kind}] ${c.title}  · project=${c.projectId ? "yes" : "none"} · conf=${c.confidence ?? "?"}${c.lowConfidence ? " (needs review)" : ""}`,
  );
}

const todos = res.created.filter((c) => c.kind === "todo").length;
const events = res.created.filter((c) => c.kind === "event").length;
console.log(`\nsummary: ${todos} todo(s), ${events} event(s)`);
if (res.created.length === 0) {
  console.error("SMOKE FAIL: no items extracted");
  process.exit(1);
}
console.log("SMOKE OK");
process.exit(0);
