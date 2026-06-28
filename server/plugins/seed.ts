import { getDb } from "../db/client";
import { seedDefaultProjects } from "../db/seed";

export default defineNitroPlugin(async () => {
  try {
    await seedDefaultProjects(getDb());
  } catch (err) {
    console.error("[seed] failed to seed default projects:", err);
  }
});
