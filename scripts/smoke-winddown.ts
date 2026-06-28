// Dev smoke: run the real end-of-day wind-down against the test DB + live DeepSeek.
// Usage: bun scripts/smoke-winddown.ts
import { makeDb } from "../server/db/client";
import { truncateAll } from "../server/db/test-helpers";
import { seedDefaultProjects } from "../server/db/seed";
import { createDump, createTodo, listUnscheduledTodos } from "../server/db/queries/items";
import { makeModel } from "../server/ai/model";
import { summarizeDay, applyWindDownSchedule } from "../server/ai/winddown";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL not set");
const db = makeDb(url);

await truncateAll(db);
const projects = await seedDefaultProjects(db);
const work = projects.find((p) => p.name === "Work")!;
const personal = projects.find((p) => p.name === "Personal")!;

await createDump(db, "messy day, lots to do for work and home");
await createTodo(db, { title: "Finish Q3 deck", projectId: work.id });
await createTodo(db, { title: "Reply to manager email", projectId: work.id });
await createTodo(db, { title: "Book dentist", projectId: personal.id });
await createTodo(db, { title: "Grocery run", projectId: personal.id });

const t0 = Date.now();
const proposal = await summarizeDay(db, makeModel(), new Date());
console.log(`\nsummarizeDay in ${Date.now() - t0}ms\n`);

console.log("GROUPS:");
for (const g of proposal.groups) {
  console.log(`  ${g.project ?? "(no project)"}: ${g.items.map((i) => i.title).join(", ")}`);
}
console.log("\nPROPOSED SCHEDULE:");
for (const s of proposal.schedule) {
  console.log(`  ${s.startsAt} → ${s.endsAt}  ${s.title}`);
}

const n = await applyWindDownSchedule(
  db,
  proposal.schedule.map((s) => ({ todoId: s.todoId, startsAt: s.startsAt, endsAt: s.endsAt })),
);
const stillUnscheduled = await listUnscheduledTodos(db);
console.log(`\napplied ${n} blocks; ${stillUnscheduled.length} todos still unscheduled`);

if (proposal.groups.length === 0 || proposal.schedule.length === 0) {
  console.error("SMOKE FAIL: empty proposal");
  process.exit(1);
}
console.log("SMOKE OK");
process.exit(0);
