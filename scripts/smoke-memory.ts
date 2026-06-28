// Dev smoke: real AI memory extraction + FTS recall against the test DB + DeepSeek.
// Usage: bun scripts/smoke-memory.ts
import { makeDb } from "../server/db/client";
import { truncateAll } from "../server/db/test-helpers";
import { makeModel } from "../server/ai/model";
import { extractMemories } from "../server/ai/memory-extract";
import { searchMemories, listMemories } from "../server/db/queries/memory";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL not set");
const db = makeDb(url);

await truncateAll(db);

const text =
  "I always do deep work in the mornings and I hate meetings after 4pm. " +
  "My manager is Sam. I'm vegetarian. Also need to remember to buy milk today.";

console.log("INPUT:\n" + text + "\n");
const n = await extractMemories(db, makeModel(), text);
console.log(`extracted ${n} durable memories:`);
for (const m of await listMemories(db)) console.log("  - " + m.content);

console.log('\nrecall search "meetings":');
for (const m of await searchMemories(db, "meetings")) console.log("  > " + m.content);

if (n === 0) {
  console.error("SMOKE FAIL: no memories extracted");
  process.exit(1);
}
console.log("\nSMOKE OK");
process.exit(0);
