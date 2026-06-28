import { z } from "zod";

const schema = z.object({
  NUXT_DATABASE_URL: z.string().min(1, "NUXT_DATABASE_URL is required"),
}).strict();

export function parseEnv(source: Record<string, string | undefined>): {
  databaseUrl: string;
} {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      if (i.path.length > 0) {
        return `${i.path.join(".")}: ${i.message}`;
      }
      return i.message;
    }).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return { databaseUrl: parsed.data.NUXT_DATABASE_URL };
}
