import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

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
  return { databaseUrl: parsed.data.DATABASE_URL };
}
