<script setup lang="ts">
import { ref, computed } from "vue";
import { startOfWeek, weekDays, addDays } from "~/composables/useWeek";
import type { Project } from "~/components/ProjectRail.vue";
import { authClient } from "~/lib/auth-client";

// ── Week navigation state ─────────────────────────────────────────────────

const anchor = ref<Date>(startOfWeek(new Date()));

function goToToday(): void {
  anchor.value = startOfWeek(new Date());
}

function prevWeek(): void {
  anchor.value = addDays(anchor.value, -7);
}

function nextWeek(): void {
  anchor.value = addDays(anchor.value, 7);
}

const days = computed(() => weekDays(anchor.value));

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const fromISO = computed(() => days.value[0].toISOString());
const toISO = computed(() => addDays(days.value[6], 1).toISOString());

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
// /api/projects will be implemented in a later task.
// Until then we return an empty list so the shell renders cleanly.

const { data: projectsData } = await useFetch<Project[]>("/api/projects", {
  default: () => [] as Project[],
  // Silently swallow 404 / unimplemented — projects rail will show "No projects yet."
  onResponseError() { /* no-op */ },
});

const projects = computed<Project[]>(() => projectsData.value ?? []);

const activeProjectIds = ref<Set<string>>(new Set());

function toggleProject(id: string): void {
  const next = new Set(activeProjectIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  activeProjectIds.value = next;
}

// Build a color map for quick lookup in child components.
const projectColorMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const p of projects.value) {
    map[p.id] = p.color;
  }
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

// ── Sign out ──────────────────────────────────────────────────────────────

async function handleSignOut(): Promise<void> {
  await authClient.signOut();
  await navigateTo("/login");
}

// ── Header label ──────────────────────────────────────────────────────────

const weekLabel = computed(() => {
  const first = days.value[0];
  const last = days.value[6];
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${first.toLocaleDateString("en-US", opts)} – ${last.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
});
</script>

<template>
  <div class="min-h-dvh bg-neutral-50 text-neutral-900 flex flex-col">
    <!-- ── Top header ──────────────────────────────────────────────────── -->
    <header class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 bg-white shrink-0">
      <!-- Week navigation -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded text-sm text-neutral-500
                 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
          aria-label="Previous week"
          @click="prevWeek"
        >
          ‹
        </button>
        <button
          type="button"
          class="px-3 h-8 rounded text-sm font-medium text-neutral-700
                 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
          @click="goToToday"
        >
          Today
        </button>
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded text-sm text-neutral-500
                 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
          aria-label="Next week"
          @click="nextWeek"
        >
          ›
        </button>
      </div>

      <!-- Week label -->
      <h1 class="text-sm font-medium text-neutral-600 tabular-nums select-none">
        {{ weekLabel }}
      </h1>

      <!-- Nav affordances -->
      <div class="flex items-center gap-2">
        <NuxtLink
          to="/dump"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Dump
        </NuxtLink>
        <NuxtLink
          to="/wind-down"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Wind down
        </NuxtLink>
        <NuxtLink
          to="/analytics"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Analytics
        </NuxtLink>
        <NuxtLink
          to="/memories"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Memory
        </NuxtLink>
        <NuxtLink
          to="/documents"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Documents
        </NuxtLink>
        <NuxtLink
          to="/chat"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Chat
        </NuxtLink>
        <NuxtLink
          to="/settings"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Settings
        </NuxtLink>
        <button
          type="button"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
          @click="handleSignOut"
        >
          Sign out
        </button>
      </div>

      <!-- View toggle -->
      <div class="flex items-center border border-neutral-200 rounded overflow-hidden">
        <button
          v-for="mode in (['day', 'week', 'month'] as const)"
          :key="mode"
          type="button"
          class="px-3 py-1 text-xs font-medium capitalize
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
          :class="viewMode === mode
            ? 'bg-neutral-900 text-white'
            : 'bg-white text-neutral-500 hover:bg-neutral-50'"
          @click="viewMode = mode"
        >
          {{ mode }}
        </button>
      </div>
    </header>

    <!-- ── Three-pane body ─────────────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left rail: projects -->
      <aside class="w-44 shrink-0 border-r border-neutral-200 bg-white overflow-y-auto">
        <ProjectRail
          :projects="projects"
          :active-ids="activeProjectIds"
          @toggle="toggleProject"
        />
      </aside>

      <!-- Center: calendar -->
      <main class="flex-1 overflow-hidden flex flex-col">
        <!-- Week view (fully built) -->
        <template v-if="viewMode === 'week'">
          <div v-if="status === 'pending'" class="flex-1 flex items-center justify-center text-sm text-neutral-400">
            Loading…
          </div>
          <div v-else-if="error" class="flex-1 flex items-center justify-center text-sm text-neutral-400">
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

        <!-- Day view stub -->
        <template v-else-if="viewMode === 'day'">
          <div class="flex-1 flex items-center justify-center text-sm text-neutral-400">
            Day view coming soon.
          </div>
        </template>

        <!-- Month view stub -->
        <template v-else>
          <div class="flex-1 flex items-center justify-center text-sm text-neutral-400">
            Month view coming soon.
          </div>
        </template>
      </main>

      <!-- Right rail: unscheduled todos -->
      <aside class="w-56 shrink-0 border-l border-neutral-200 bg-white overflow-y-auto">
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
