import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { Db } from "../db/client";
import { createMemory } from "../db/queries/memory";

// ── saveMemories ───────────────────────────────────────────────────────────

/**
 * Inserts each non-empty trimmed fact as a memory with source "dump".
 * Returns the count of memories actually inserted.
 */
export async function saveMemories(db: Db, facts: string[]): Promise<number> {
  let count = 0;
  for (const fact of facts) {
    const trimmed = fact.trim();
    if (!trimmed) continue;
    await createMemory(db, { content: trimmed, source: "dump" });
    count += 1;
  }
  return count;
}

// ── extractMemories ────────────────────────────────────────────────────────

const memoriesSchema = z.object({
  memories: z.array(z.string()),
});

const SYSTEM_PROMPT =
  "Extract ONLY durable, reusable facts about the user worth remembering across days — " +
  "preferences, recurring people/projects, constraints, habits, working style. " +
  "Ignore one-off tasks, ephemeral details, and dated to-dos. " +
  "Return an empty array if nothing is durable.";

/**
 * Uses the model to extract durable memories from a brain-dump text,
 * then persists them via saveMemories. Returns the count saved.
 */
export async function extractMemories(
  db: Db,
  model: LanguageModel,
  text: string,
): Promise<number> {
  const { object } = await generateObject({
    model,
    schema: memoriesSchema,
    system: SYSTEM_PROMPT,
    prompt: text,
  });

  return saveMemories(db, object.memories);
}
