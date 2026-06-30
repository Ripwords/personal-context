import type { Project } from "../db/schema";

export type ProjectMatch = { projectId: string | null; score: number };

/**
 * Deterministic, keyword-biased project classifier. Scores each project by how
 * many of its keywords (and its name) appear in `text`, and returns the best
 * match. A name mention counts double — naming a project is a stronger signal
 * than a stray keyword. Returns `{ projectId: null, score: 0 }` when nothing
 * matches. Case-insensitive; word-boundary matched so "gym" doesn't hit "gymnast".
 */
export function classifyProjectByKeywords(
  text: string,
  projects: ReadonlyArray<Project>,
): ProjectMatch {
  const hay = ` ${text.toLowerCase()} `;
  const hit = (needle: string): boolean => {
    const n = needle.trim().toLowerCase();
    if (!n) return false;
    // Word-boundary contains: avoids "gym" matching "gymnast".
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(n)}([^a-z0-9]|$)`).test(hay);
  };

  let best: ProjectMatch = { projectId: null, score: 0 };
  for (const p of projects) {
    let score = 0;
    for (const kw of p.keywords) if (hit(kw)) score += 1;
    if (hit(p.name)) score += 2;
    if (score > best.score) best = { projectId: p.id, score };
  }
  return best;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
