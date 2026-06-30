// Pure logic for the calendar copilot: deciding when an assistant turn has
// actually changed the calendar (so the timeline should refresh) vs. a plain
// Q&A turn (which should not). Kept framework-free so it's unit-testable.

export const MUTATION_TOOLS = [
  "create_event",
  "create_todo",
  "delete_event",
  "update_event",
] as const;

export type MutationTool = (typeof MUTATION_TOOLS)[number];

/** Minimal shape of an AI SDK tool UI part, narrowed to what we inspect. */
export interface ToolPartLike {
  toolName: string;
  toolCallId: string;
  /** AI SDK ToolState — "output-available" is the successful terminal state. */
  state: string;
  output?: unknown;
}

function isMutationTool(name: string): name is MutationTool {
  return (MUTATION_TOOLS as readonly string[]).includes(name);
}

/**
 * True only when this tool part is a *completed, successful* calendar mutation.
 * The tool outputs report failure in shape-specific ways:
 *   create_* → { id, error? }  (success = has id, no error)
 *   delete_event → { deleted: boolean }
 *   update_event → { updated: boolean }
 */
export function isSuccessfulMutation(part: ToolPartLike): boolean {
  if (!isMutationTool(part.toolName)) return false;
  if (part.state !== "output-available") return false;

  const out = part.output;
  if (out === null || typeof out !== "object") return false;
  const o = out as Record<string, unknown>;

  if ("deleted" in o) return o.deleted === true;
  if ("updated" in o) return o.updated === true;
  if ("created" in o) return !o.error && Boolean(o.id);
  return false;
}

/**
 * Given all tool parts seen so far and the set of call ids already acted on,
 * return the ids of newly-completed successful mutations. The caller adds these
 * to `seen` and refreshes the calendar when the result is non-empty.
 */
export function newMutationCallIds(
  parts: ReadonlyArray<ToolPartLike>,
  seen: ReadonlySet<string>,
): string[] {
  const fresh: string[] = [];
  for (const part of parts) {
    if (seen.has(part.toolCallId)) continue;
    if (isSuccessfulMutation(part)) fresh.push(part.toolCallId);
  }
  return fresh;
}
