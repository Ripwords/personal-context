<script setup lang="ts">
import { computed } from "vue";
import { authClient } from "~/lib/auth-client";
import { useReminderToggle } from "~/composables/useReminderToggle";

// ── Reminder notifications ──────────────────────────────────────────────────
const { enabled, permission, active, enable, disable } = useReminderToggle();

const reminderHint = computed(() => {
  if (permission.value === "unsupported") return "This browser doesn't support notifications.";
  if (permission.value === "denied") return "Notifications are blocked in your browser settings — allow them for this site, then toggle again.";
  if (active.value) return "You'll get a browser notification at each reminder's time (while this tab is open).";
  return "Get a browser notification when a timed todo is due.";
});

async function toggleReminders(): Promise<void> {
  if (enabled.value) { disable(); return; }
  await enable(); // requests permission if needed; flips on only when granted
}

type ConnectionRole = "personal" | "work";

interface Connection {
  accountId: string;
  email: string | null;
  role: ConnectionRole;
  braindumpCalendarId: string | null;
}

const { data: connections, refresh } = await useFetch<Connection[]>("/api/connections");
const roleError = ref<string | null>(null);

// Show the account's email; fall back to a shortened id until the calendar syncs.
function accountLabel(c: Connection): string {
  return c.email ?? `${c.accountId.slice(0, 10)}… (sign-in syncs email)`;
}

async function addAccount() {
  await authClient.linkSocial({ provider: "google", callbackURL: "/settings" });
}

async function setRole(accountId: string, role: ConnectionRole) {
  roleError.value = null;
  try {
    await $fetch("/api/connections/role", {
      method: "POST",
      body: { accountId, role },
    });
    await refresh();
  } catch (err) {
    roleError.value = err instanceof Error ? err.message : "Failed to update role";
  }
}

// ── Projects (CRUD + keyword tuning for the tagging classifier) ─────────────
interface Project {
  id: string;
  name: string;
  color: string;
  kind: string;
  keywords: string[];
}

const { data: projects, refresh: refreshProjects } = await useFetch<Project[]>(
  "/api/projects",
  { default: () => [] },
);
const newProjectName = ref("");
const newProjectColor = ref("#0D9488");
const projectError = ref<string | null>(null);

async function addProject() {
  if (!newProjectName.value.trim()) return;
  projectError.value = null;
  try {
    await $fetch("/api/projects", {
      method: "POST",
      body: { name: newProjectName.value.trim(), color: newProjectColor.value, kind: "other", keywords: [] },
    });
    newProjectName.value = "";
    await refreshProjects();
  } catch {
    projectError.value = "Couldn't create project";
  }
}

async function patchProject(p: Project, body: Record<string, unknown>) {
  try {
    await $fetch(`/api/projects/${p.id}`, { method: "PATCH", body });
    await refreshProjects();
  } catch {
    projectError.value = "Couldn't update project";
  }
}

function renameProject(p: Project, name: string) {
  if (!name.trim() || name.trim() === p.name) return;
  void patchProject(p, { name: name.trim() });
}

function saveKeywords(p: Project, csv: string) {
  const keywords = csv.split(",").map((s) => s.trim()).filter(Boolean);
  void patchProject(p, { keywords });
}

async function removeProject(p: Project) {
  try {
    await $fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    await refreshProjects();
  } catch {
    projectError.value = "Couldn't delete project";
  }
}
</script>

<template>
  <div class="min-h-dvh bd-bg bd-text flex flex-col">
    <AppHeader title="Settings" />
    <main class="flex-1 mx-auto max-w-xl w-full px-6 py-12 flex flex-col gap-10">
      <!-- Reminder notifications — client-only: state comes from localStorage + the
           live Notification permission, neither available during SSR. -->
      <ClientOnly>
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold tracking-tight bd-muted">Reminders</h2>
        <div class="flex items-center justify-between gap-4 px-4 py-3 border bd-border rounded-lg bd-surface">
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm bd-text">Browser notifications</span>
            <span class="text-xs bd-faint">{{ reminderHint }}</span>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="active"
            :disabled="permission === 'unsupported'"
            @click="toggleReminders"
            class="relative shrink-0 w-11 h-6 rounded-full motion-safe:transition-colors disabled:opacity-40
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            :class="active ? 'bg-[var(--bd-surface-2)]' : 'bd-bg border bd-border'"
          >
            <span
              class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-neutral-300 motion-safe:transition-transform"
              :class="active ? 'translate-x-5' : ''"
            />
          </button>
        </div>
      </section>
      </ClientOnly>

      <section class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight bd-muted">Connected Google accounts</h2>
          <UButton color="neutral" variant="outline" size="sm" @click="addAccount">
            Add account
          </UButton>
        </div>

        <p v-if="roleError" class="text-xs text-red-400">{{ roleError }}</p>

        <ul v-if="connections && connections.length > 0" class="divide-y divide-neutral-800 border bd-border rounded-lg overflow-hidden">
          <li
            v-for="conn in connections"
            :key="conn.accountId"
            class="flex items-center justify-between px-4 py-3 bd-surface"
          >
            <span class="text-sm bd-muted truncate max-w-xs">{{ accountLabel(conn) }}</span>
            <div class="flex items-center gap-2 ml-4 shrink-0">
              <UButton
                size="xs"
                color="neutral"
                :variant="conn.role === 'personal' ? 'solid' : 'outline'"
                @click="setRole(conn.accountId, 'personal')"
              >
                Personal
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                :variant="conn.role === 'work' ? 'solid' : 'outline'"
                @click="setRole(conn.accountId, 'work')"
              >
                Work
              </UButton>
            </div>
          </li>
        </ul>

        <p v-else class="text-sm bd-faint">No connected accounts yet.</p>
      </section>

      <!-- Projects -->
      <section class="flex flex-col gap-4">
        <h2 class="text-sm font-semibold tracking-tight bd-muted">Projects</h2>
        <p class="text-xs bd-faint -mt-2">
          Keywords bias the AI's auto-tagging. Edit a project's keywords (comma-separated) to teach it.
        </p>

        <p v-if="projectError" class="text-xs text-red-400">{{ projectError }}</p>

        <ul v-if="projects && projects.length > 0" class="flex flex-col gap-2">
          <li
            v-for="p in projects"
            :key="p.id"
            class="flex items-center gap-3 px-4 py-3 border bd-border rounded-lg bd-surface"
          >
            <span class="shrink-0 w-3 h-3 rounded-full" :style="{ backgroundColor: p.color }" aria-hidden="true" />
            <input
              class="w-32 shrink-0 text-sm bg-transparent bd-text border-b border-transparent hover:border-[var(--bd-border)] focus:border-[var(--bd-border)] focus-visible:outline-none"
              :value="p.name"
              :aria-label="`Project name`"
              @change="renameProject(p, ($event.target as HTMLInputElement).value)"
            />
            <input
              class="flex-1 text-xs bd-muted bg-transparent border-b border-transparent hover:border-[var(--bd-border)] focus:border-[var(--bd-border)] focus-visible:outline-none"
              :value="p.keywords.join(', ')"
              placeholder="keywords, comma, separated"
              :aria-label="`Keywords for ${p.name}`"
              @change="saveKeywords(p, ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="shrink-0 text-xs bd-faint hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 rounded"
              :aria-label="`Delete ${p.name}`"
              @click="removeProject(p)"
            >
              ✕
            </button>
          </li>
        </ul>

        <div class="flex items-center gap-2">
          <input
            type="color"
            v-model="newProjectColor"
            class="shrink-0 w-8 h-8 rounded bg-transparent border bd-border cursor-pointer"
            aria-label="New project color"
          />
          <input
            v-model="newProjectName"
            placeholder="New project name"
            class="flex-1 text-sm bd-text bd-surface border bd-border rounded px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            @keydown.enter="addProject"
          />
          <UButton color="neutral" variant="outline" size="sm" :disabled="!newProjectName.trim()" @click="addProject">
            Add
          </UButton>
        </div>
      </section>
    </main>
  </div>
</template>
