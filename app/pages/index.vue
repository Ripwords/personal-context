<script setup lang="ts">
import { ref, computed } from "vue";
import { startOfWeek, weekDays, addDays } from "~/composables/useWeek";
import type { Project } from "~/components/ProjectRail.vue";
import { authClient } from "~/lib/auth-client";

// ── Week navigation state ─────────────────────────────────────────────────

// useWeek operates on UTC-midnight date markers. Seed it from the viewer's LOCAL
// calendar date (not the raw instant) so "this week" is the local week even when
// UTC has already rolled over to the next day.
function localTodayMarker(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

const anchor = ref<Date>(startOfWeek(localTodayMarker()));

function goToToday(): void {
  anchor.value = startOfWeek(localTodayMarker());
}

function prevWeek(): void {
  anchor.value = addDays(anchor.value, -7);
}

function nextWeek(): void {
  anchor.value = addDays(anchor.value, 7);
}

const days = computed(() => weekDays(anchor.value));

// Pad the fetch window by a day on each side: the visible week is a set of LOCAL
// days, which can extend up to ~14h beyond the UTC-marker boundaries. The grid
// buckets events into the 7 local columns, so over-fetching adjacent days is safe.
const fromISO = computed(() => addDays(days.value[0], -1).toISOString());
const toISO = computed(() => addDays(days.value[6], 2).toISOString());

// ── View toggle ───────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month";
const viewMode = ref<ViewMode>("week");

// ── Calendar data via useFetch ────────────────────────────────────────────

interface CalEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  projectId: string | null;
  color: string | null;
  allDay: boolean;
}

interface CalTodo {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}

interface CalendarFeed {
  events: CalEvent[];
  allDayEvents: CalEvent[];
  scheduledTodos: CalTodo[];
  unscheduledTodos: CalTodo[];
}

const {
  data: feed,
  status,
  error,
  refresh,
} = await useFetch<CalendarFeed>("/api/calendar/events", {
  query: computed(() => ({ from: fromISO.value, to: toISO.value })),
});

// ── Projects ──────────────────────────────────────────────────────────────

const { data: projectsData } = await useFetch<Project[]>("/api/projects", {
  default: () => [] as Project[],
  onResponseError() { /* projects rail tolerates an empty list */ },
});

const projects = computed<Project[]>(() => projectsData.value ?? []);
const activeProjectIds = ref<Set<string>>(new Set());

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
  const raw = feed.value?.events ?? [];
  if (activeProjectIds.value.size === 0) return raw;
  return raw.filter((e) => e.projectId != null && activeProjectIds.value.has(e.projectId));
});

const scheduledTodos = computed(() => {
  const raw = feed.value?.scheduledTodos ?? [];
  if (activeProjectIds.value.size === 0) return raw;
  return raw.filter((t) => t.projectId != null && activeProjectIds.value.has(t.projectId));
});

const allDayEvents = computed(() => feed.value?.allDayEvents ?? []);
const unscheduledTodos = computed(() => feed.value?.unscheduledTodos ?? []);

async function dropTodo(id: string): Promise<void> {
  await $fetch(`/api/todos/${id}`, { method: "DELETE" });
  await refresh();
}

async function clearUnscheduled(): Promise<void> {
  await $fetch("/api/todos/clear-unscheduled", { method: "POST" });
  await refresh();
}

// ── Brain dump quick capture (primary action) ──────────────────────────────

interface CreatedItem { kind: "todo" | "event"; title: string }
interface DumpResult { created: CreatedItem[]; memoriesSaved: number }

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
    await refresh();
    const todos = res.created.filter((c) => c.kind === "todo").length;
    const events = res.created.filter((c) => c.kind === "event").length;
    const parts: string[] = [];
    if (events) parts.push(`${events} event${events > 1 ? "s" : ""}`);
    if (todos) parts.push(`${todos} todo${todos > 1 ? "s" : ""}`);
    if (res.memoriesSaved) parts.push(`${res.memoriesSaved} memory`);
    toast.add({
      title: parts.length ? `Sorted into ${parts.join(", ")}` : "Captured",
      description: res.created.map((c) => c.title).slice(0, 3).join(" · ") || undefined,
      color: "neutral",
    });
  } catch {
    toast.add({ title: "Couldn't capture that", description: "Try again in a moment.", color: "error" });
  } finally {
    dumping.value = false;
  }
}

// ── Header / overflow menu ──────────────────────────────────────────────────

const menuOpen = ref(false);
const navLinks = [
  { to: "/chat", label: "Chat" },
  { to: "/wind-down", label: "Wind down" },
  { to: "/memories", label: "Memory" },
  { to: "/documents", label: "Documents" },
  { to: "/analytics", label: "Analytics" },
  { to: "/settings", label: "Settings" },
];

async function handleSignOut(): Promise<void> {
  await authClient.signOut();
  await navigateTo("/login");
}

const monthTitle = computed(() =>
  days.value[3].toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
);
</script>

<template>
  <div class="min-h-dvh bd-bg bd-text flex flex-col">
    <!-- ── Top bar ─────────────────────────────────────────────────────────── -->
    <header class="flex items-center gap-4 px-4 h-14 border-b bd-border bd-surface shrink-0">
      <!-- Month title -->
      <h1 class="text-lg font-semibold tracking-tight whitespace-nowrap select-none">
        {{ monthTitle }}
      </h1>

      <!-- Week nav -->
      <div class="flex items-center gap-0.5">
        <button
          type="button" aria-label="Previous week" @click="prevWeek"
          class="w-7 h-7 flex items-center justify-center rounded bd-muted bd-hover motion-safe:transition-colors
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
        >‹</button>
        <button
          type="button" @click="goToToday"
          class="px-2.5 h-7 rounded text-xs font-medium bd-muted bd-hover motion-safe:transition-colors
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
        >Today</button>
        <button
          type="button" aria-label="Next week" @click="nextWeek"
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

      <!-- Overflow menu -->
      <div class="relative shrink-0">
        <button
          type="button" aria-label="Menu" @click="menuOpen = !menuOpen"
          class="w-8 h-8 flex items-center justify-center rounded-full bd-surface-2 bd-text text-sm
                 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
        >⋯</button>
        <template v-if="menuOpen">
          <div class="fixed inset-0 z-10" @click="menuOpen = false" />
          <div class="absolute right-0 mt-1 w-44 z-20 rounded-lg border bd-border bd-surface py-1 shadow-xl shadow-black/40">
            <NuxtLink
              v-for="l in navLinks" :key="l.to" :to="l.to" @click="menuOpen = false"
              class="block px-3 py-1.5 text-sm bd-muted hover:text-[var(--bd-text)] bd-hover motion-safe:transition-colors"
            >{{ l.label }}</NuxtLink>
            <div class="my-1 border-t bd-border" />
            <button
              type="button" @click="handleSignOut"
              class="block w-full text-left px-3 py-1.5 text-sm bd-muted hover:text-[var(--bd-text)] bd-hover motion-safe:transition-colors"
            >Sign out</button>
          </div>
        </template>
      </div>
    </header>

    <!-- ── Three-pane body ─────────────────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left rail: calendars + projects -->
      <aside class="w-48 shrink-0 border-r bd-border bd-surface overflow-y-auto flex flex-col">
        <CalendarRail @changed="refresh" />
        <ProjectRail
          :projects="projects"
          :active-ids="activeProjectIds"
          @toggle="toggleProject"
        />
      </aside>

      <!-- Center: calendar -->
      <main class="flex-1 overflow-hidden flex flex-col bd-bg">
        <template v-if="viewMode === 'week'">
          <div v-if="status === 'pending'" class="flex-1 flex items-center justify-center text-sm bd-faint">
            Loading…
          </div>
          <div v-else-if="error" class="flex-1 flex items-center justify-center text-sm bd-faint">
            {{ error.statusCode === 401 ? 'Sign in to view your calendar.' : 'Failed to load events.' }}
          </div>
          <CalendarWeek
            v-else
            class="flex-1 overflow-hidden"
            :days="days"
            :events="events"
            :all-day-events="allDayEvents"
            :scheduled-todos="scheduledTodos"
            :project-color-map="projectColorMap"
          />
        </template>

        <template v-else-if="viewMode === 'day'">
          <div class="flex-1 flex items-center justify-center text-sm bd-faint">Day view coming soon.</div>
        </template>

        <template v-else>
          <div class="flex-1 flex items-center justify-center text-sm bd-faint">Month view coming soon.</div>
        </template>
      </main>

      <!-- Right rail: unscheduled todos -->
      <aside class="w-56 shrink-0 border-l bd-border bd-surface overflow-y-auto">
        <UnscheduledRail
          :todos="unscheduledTodos"
          :project-color-map="projectColorMap"
          @drop="dropTodo"
          @clear-all="clearUnscheduled"
        />
      </aside>
    </div>
  </div>
</template>
