<script setup lang="ts">
import { ref, computed } from "vue";
import type { Project } from "~/components/ProjectRail.vue";
import type CalendarTimeline from "~/components/CalendarTimeline.vue";
import { useCalendarFeed } from "~/composables/useCalendarFeed";
import { authClient } from "~/lib/auth-client";

// ── Calendar: lazily-loaded feed feeding the smooth-scrolling timeline ─────
// The timeline emits the weeks scrolling into view; the feed fetches each one
// on demand, so panning loads (and syncs) new territory just in time.
const timeline = ref<InstanceType<typeof CalendarTimeline> | null>(null);
const centerDate = ref<Date>(new Date());

const {
  events: feedEvents,
  allDayEvents: feedAllDay,
  scheduledTodos: feedScheduledTodos,
  unscheduledTodos: feedUnscheduled,
  loading,
  hasAny,
  lastError,
  ensureWeeks,
  reload,
} = useCalendarFeed();

// ── View toggle ───────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month";
const viewMode = ref<ViewMode>("week");

// ── Projects ──────────────────────────────────────────────────────────────

const { data: projectsData } = await useFetch<Project[]>("/api/projects", {
  default: () => [] as Project[],
  onResponseError() { /* projects rail tolerates an empty list */ },
});

const projects = computed<Project[]>(() => projectsData.value ?? []);
const activeProjectIds = ref<Set<string>>(new Set());

// ── Reminders (timed todos — notify instead of occupying the calendar) ──────
interface Reminder { id: string; title: string; remindAt: string }
const { data: remindersData, refresh: refreshReminders } = await useFetch<Reminder[]>("/api/reminders", {
  default: () => [] as Reminder[],
  onResponseError() { /* rail tolerates an empty list */ },
});
const reminders = computed<Reminder[]>(() => remindersData.value ?? []);

function formatReminderTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// After any AI change (copilot/dump) refresh both the calendar and the reminders.
async function refreshAll(): Promise<void> {
  await Promise.all([reload(), refreshReminders()]);
}

function toggleProject(id: string): void {
  const next = new Set(activeProjectIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  activeProjectIds.value = next;
}

const projectColorMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const p of projects.value) map[p.id] = p.color;
  return map;
});

// ── Filtered feed ─────────────────────────────────────────────────────────

const events = computed(() => {
  if (activeProjectIds.value.size === 0) return feedEvents.value;
  return feedEvents.value.filter(
    (e) => e.projectId != null && activeProjectIds.value.has(e.projectId),
  );
});

const scheduledTodos = computed(() => {
  if (activeProjectIds.value.size === 0) return feedScheduledTodos.value;
  return feedScheduledTodos.value.filter(
    (t) => t.projectId != null && activeProjectIds.value.has(t.projectId),
  );
});

const allDayEvents = computed(() => feedAllDay.value);
const unscheduledTodos = computed(() => feedUnscheduled.value);

async function dropTodo(id: string): Promise<void> {
  await $fetch(`/api/todos/${id}`, { method: "DELETE" });
  await reload();
}

async function clearUnscheduled(): Promise<void> {
  await $fetch("/api/todos/clear-unscheduled", { method: "POST" });
  await reload();
}

// ── Brain dump quick capture (primary action) ──────────────────────────────

interface CreatedItem { kind: "todo" | "event"; title: string }
interface DumpResult {
  created: CreatedItem[];
  memoriesSaved: number;
  writtenToGoogle?: number;
  needsReauth?: boolean;
  removedCount?: number;
  updatedCount?: number;
}

const toast = useToast();
const dumpText = ref<string>("");
const dumping = ref<boolean>(false);

async function submitDump(): Promise<void> {
  const text = dumpText.value.trim();
  if (!text || dumping.value) return;
  dumping.value = true;
  try {
    const res = await $fetch<DumpResult>("/api/dump", {
      method: "POST",
      body: { text, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    dumpText.value = "";
    await refreshAll();
    const todos = res.created.filter((c) => c.kind === "todo").length;
    const events = res.created.filter((c) => c.kind === "event").length;
    const parts: string[] = [];
    if (events) parts.push(`${events} event${events > 1 ? "s" : ""}`);
    if (todos) parts.push(`${todos} todo${todos > 1 ? "s" : ""}`);
    if (res.removedCount) parts.push(`removed ${res.removedCount}`);
    if (res.updatedCount) parts.push(`updated ${res.updatedCount}`);
    if (res.memoriesSaved) parts.push(`${res.memoriesSaved} memory`);
    toast.add({
      title: parts.length ? `Done — ${parts.join(", ")}` : "Captured",
      description: res.created.map((c) => c.title).slice(0, 3).join(" · ") || undefined,
      color: "neutral",
    });
    // Write-back to Google needs the calendar permission — prompt a re-sign-in.
    if (res.needsReauth) {
      toast.add({
        title: "Saved locally — not synced to Google",
        description: "Sign in again to grant calendar access, then it'll appear in Google/Notion.",
        color: "warning",
        actions: [{ label: "Sign in again", onClick: () => handleSignOut() }],
      });
    } else if (res.writtenToGoogle) {
      toast.add({ title: `Synced ${res.writtenToGoogle} to Google`, color: "success" });
    }
  } catch {
    toast.add({ title: "Couldn't capture that", description: "Try again in a moment.", color: "error" });
  } finally {
    dumping.value = false;
  }
}

// ── Sign-out (also used by the "not synced" reauth toast action) ────────────

async function handleSignOut(): Promise<void> {
  await authClient.signOut();
  await navigateTo("/login");
}

const monthTitle = computed(() =>
  centerDate.value.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
);
</script>

<template>
  <div class="h-dvh overflow-hidden bd-bg bd-text flex flex-col">
    <!-- ── Top bar ─────────────────────────────────────────────────────────── -->
    <header class="flex items-center gap-4 px-4 h-14 border-b bd-border bd-surface shrink-0">
      <!-- Month title -->
      <h1 class="text-lg font-semibold tracking-tight whitespace-nowrap select-none">
        {{ monthTitle }}
      </h1>

      <!-- Week nav -->
      <div class="flex items-center gap-0.5">
        <button
          type="button" aria-label="Previous week" @click="timeline?.prev()"
          class="w-7 h-7 flex items-center justify-center rounded bd-muted bd-hover motion-safe:transition-colors
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
        >‹</button>
        <button
          type="button" @click="timeline?.goToToday()"
          class="px-2.5 h-7 rounded text-xs font-medium bd-muted bd-hover motion-safe:transition-colors
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
        >Today</button>
        <button
          type="button" aria-label="Next week" @click="timeline?.next()"
          class="w-7 h-7 flex items-center justify-center rounded bd-muted bd-hover motion-safe:transition-colors
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
        >›</button>
      </div>

      <!-- Quick capture — the primary action -->
      <form class="flex-1 max-w-2xl mx-auto" @submit.prevent="submitDump">
        <div class="flex items-center gap-2 h-9 px-3 rounded-lg border bd-border bd-bg
                    focus-within:ring-2 focus-within:ring-neutral-500 motion-safe:transition-shadow">
          <span class="bd-faint text-sm select-none" aria-hidden="true">✎</span>
          <input
            v-model="dumpText"
            type="text"
            :disabled="dumping"
            placeholder="Brain dump — type anything, AI will sort it…"
            class="flex-1 bg-transparent text-sm bd-text placeholder:bd-faint outline-none disabled:opacity-60"
            aria-label="Brain dump"
          />
          <button
            type="submit"
            :disabled="dumping || !dumpText.trim()"
            class="text-xs font-medium px-2.5 py-1 rounded bd-surface-2 bd-text
                   disabled:opacity-40 enabled:hover:opacity-90 motion-safe:transition-opacity
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
          >{{ dumping ? "Sorting…" : "Capture" }}</button>
        </div>
      </form>

      <!-- View toggle -->
      <div class="flex items-center rounded-lg border bd-border overflow-hidden shrink-0">
        <button
          v-for="mode in (['day', 'week', 'month'] as const)"
          :key="mode" type="button" @click="viewMode = mode"
          class="px-2.5 h-7 text-xs font-medium capitalize motion-safe:transition-colors
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500"
          :class="viewMode === mode ? 'bg-[var(--bd-surface-2)] bd-text' : 'bd-faint bd-hover'"
        >{{ mode }}</button>
      </div>

      <!-- Overflow / navigation menu -->
      <AppNavMenu />
    </header>

    <!-- ── Three-pane body ─────────────────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left rail: calendars + projects -->
      <aside class="w-48 shrink-0 border-r bd-border bd-surface overflow-y-auto flex flex-col">
        <CalendarRail @changed="reload" />
        <ProjectRail
          :projects="projects"
          :active-ids="activeProjectIds"
          @toggle="toggleProject"
        />
      </aside>

      <!-- Center: calendar -->
      <main class="flex-1 overflow-hidden flex flex-col bd-bg">
        <template v-if="viewMode === 'week'">
          <div class="relative flex-1 overflow-hidden">
            <!-- Smooth-scrolling, lazily-loaded horizontal timeline -->
            <CalendarTimeline
              ref="timeline"
              class="h-full"
              :events="events"
              :all-day-events="allDayEvents"
              :scheduled-todos="scheduledTodos"
              :project-color-map="projectColorMap"
              @visible-weeks="ensureWeeks"
              @update:center-date="centerDate = $event"
            />

            <!-- First-load / error overlays (kept off the grid so it never unmounts mid-scroll) -->
            <div
              v-if="loading && !hasAny"
              class="absolute inset-0 flex items-center justify-center text-sm bd-faint bd-bg pointer-events-none"
            >
              Loading…
            </div>
            <div
              v-else-if="lastError && !hasAny"
              class="absolute inset-0 flex items-center justify-center text-sm bd-faint bd-bg"
            >
              {{ lastError.statusCode === 401 ? 'Sign in to view your calendar.' : 'Failed to load events.' }}
            </div>
          </div>
        </template>

        <template v-else-if="viewMode === 'day'">
          <div class="flex-1 flex items-center justify-center text-sm bd-faint">Day view coming soon.</div>
        </template>

        <template v-else>
          <div class="flex-1 flex items-center justify-center text-sm bd-faint">Month view coming soon.</div>
        </template>
      </main>

      <!-- Right rail: reminders + unscheduled todos -->
      <aside class="w-56 shrink-0 border-l bd-border bd-surface overflow-y-auto flex flex-col">
        <!-- Reminders (timed todos) — notify, never gridded -->
        <section v-if="reminders.length > 0" class="border-b bd-border p-3 flex flex-col gap-2">
          <h2 class="text-[11px] font-semibold tracking-widest uppercase bd-faint">Reminders</h2>
          <ul class="flex flex-col gap-1">
            <li
              v-for="r in reminders"
              :key="r.id"
              class="flex items-start gap-2 px-2 py-1.5 rounded border bd-border bd-bg"
            >
              <span aria-hidden="true" class="text-xs leading-5">🔔</span>
              <div class="flex flex-col min-w-0">
                <span class="text-sm bd-text truncate">{{ r.title }}</span>
                <span class="text-[11px] bd-faint tabular-nums">{{ formatReminderTime(r.remindAt) }}</span>
              </div>
            </li>
          </ul>
        </section>

        <UnscheduledRail
          :todos="unscheduledTodos"
          :project-color-map="projectColorMap"
          @drop="dropTodo"
          @clear-all="clearUnscheduled"
        />
      </aside>
    </div>

    <!-- Conversational copilot — refreshes the timeline + reminders after any change -->
    <CalendarCopilot @changed="refreshAll" />
  </div>
</template>
