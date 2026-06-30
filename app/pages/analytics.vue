<script setup lang="ts">
// ── Analytics response shape (mirrors server/db/queries/analytics output) ──

interface TodoStats {
  open: number;
  done: number;
  dropped: number;
  completionRate: number;
}

interface SchedulingStats {
  scheduled: number;
  unscheduled: number;
}

interface ProjectBreakdown {
  project: string;
  color: string;
  todos: number;
  events: number;
}

interface DayCount {
  day: string;
  count: number;
}

interface HourCount {
  hour: number;
  count: number;
}

interface Analytics {
  todos: TodoStats;
  scheduling: SchedulingStats;
  byProject: ProjectBreakdown[];
  dumpsPerDay: DayCount[];
  captureByHour: HourCount[];
  streakDays: number;
}

// ── Data fetching ─────────────────────────────────────────────────────────

const { data, status, error } = await useFetch<Analytics>("/api/analytics");

// ── Derived helpers ───────────────────────────────────────────────────────

const isEmpty = computed<boolean>(() => {
  if (!data.value) return true;
  const { todos, scheduling } = data.value;
  return (
    todos.open === 0 &&
    todos.done === 0 &&
    todos.dropped === 0 &&
    scheduling.scheduled === 0 &&
    scheduling.unscheduled === 0
  );
});

const dumpsMaxCount = computed<number>(() => {
  const counts = data.value?.dumpsPerDay.map((d) => d.count) ?? [];
  return Math.max(1, ...counts);
});

const hourMaxCount = computed<number>(() => {
  const counts = data.value?.captureByHour.map((h) => h.count) ?? [];
  return Math.max(1, ...counts);
});

function barHeightPct(count: number, max: number): string {
  return `${Math.round((count / max) * 100)}%`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
</script>

<template>
  <div class="min-h-dvh bd-bg bd-text flex flex-col">
    <!-- ── Header ─────────────────────────────────────────────────────── -->
    <AppHeader title="Analytics" />

    <!-- ── Loading ───────────────────────────────────────────────────── -->
    <div
      v-if="status === 'pending'"
      class="flex-1 flex items-center justify-center text-sm bd-faint"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>

    <!-- ── Auth error ─────────────────────────────────────────────────── -->
    <div
      v-else-if="error"
      class="flex-1 flex items-center justify-center text-sm bd-faint"
      role="alert"
    >
      {{ error.statusCode === 401 ? "Sign in to view analytics." : "Failed to load analytics." }}
    </div>

    <!-- ── Main content ───────────────────────────────────────────────── -->
    <main v-else class="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full space-y-10">

      <!-- Empty state -->
      <p
        v-if="isEmpty"
        class="text-sm bd-faint text-center py-16"
        aria-live="polite"
      >
        No data yet — start dumping.
      </p>

      <template v-else>
        <!-- ── Headline stat cards ─────────────────────────────────────── -->
        <section aria-label="Summary statistics">
          <h2 class="text-xs font-semibold tracking-widest uppercase bd-faint mb-3">
            Overview
          </h2>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-px border bd-border bg-[var(--bd-border)] rounded overflow-hidden">
            <!-- Completion rate -->
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Completion</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ Math.round((data?.todos.completionRate ?? 0) * 100) }}%
              </span>
            </div>
            <!-- Open / Done / Dropped -->
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Open</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ data?.todos.open ?? 0 }}
              </span>
            </div>
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Done</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ data?.todos.done ?? 0 }}
              </span>
            </div>
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Dropped</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ data?.todos.dropped ?? 0 }}
              </span>
            </div>
          </div>

          <!-- Second row: scheduling + streak -->
          <div class="mt-px grid grid-cols-2 sm:grid-cols-3 gap-px border bd-border bg-[var(--bd-border)] rounded overflow-hidden mt-2">
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Reminders</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ data?.scheduling.scheduled ?? 0 }}
              </span>
            </div>
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Unscheduled</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ data?.scheduling.unscheduled ?? 0 }}
              </span>
            </div>
            <div class="bd-bg px-4 py-4 flex flex-col gap-1">
              <span class="text-xs bd-faint uppercase tracking-widest">Streak</span>
              <span class="text-2xl font-semibold tabular-nums bd-text">
                {{ data?.streakDays ?? 0 }}
                <span class="text-sm font-normal bd-faint">days</span>
              </span>
            </div>
          </div>
        </section>

        <!-- ── Dumps per day sparkline ─────────────────────────────────── -->
        <section aria-label="Dumps per day — last 14 days">
          <h2 class="text-xs font-semibold tracking-widest uppercase bd-faint mb-3">
            Dumps / day (14d)
          </h2>
          <div
            class="flex items-end gap-1 h-16 border-b bd-border"
            role="img"
            aria-label="Bar chart of dumps per day over the last 14 days"
          >
            <div
              v-for="(item, i) in data?.dumpsPerDay ?? []"
              :key="item.day"
              class="flex-1 bg-neutral-800 rounded-t-sm motion-safe:transition-all motion-safe:duration-300"
              :style="{ height: barHeightPct(item.count, dumpsMaxCount) }"
              :aria-label="`${formatDay(item.day)}: ${item.count}`"
              :title="`${formatDay(item.day)}: ${item.count}`"
            />
          </div>
          <!-- Sparse axis labels -->
          <div class="flex justify-between mt-1 text-[10px] bd-faint tabular-nums select-none">
            <span>{{ data?.dumpsPerDay[0] ? formatDay(data.dumpsPerDay[0].day) : "" }}</span>
            <span>{{ data?.dumpsPerDay[13] ? formatDay(data.dumpsPerDay[13].day) : "" }}</span>
          </div>
        </section>

        <!-- ── Capture by hour histogram ──────────────────────────────── -->
        <section aria-label="Captures by hour of day">
          <h2 class="text-xs font-semibold tracking-widest uppercase bd-faint mb-3">
            Capture by hour
          </h2>
          <div
            class="flex items-end gap-px h-12 border-b bd-border"
            role="img"
            aria-label="Bar chart of captures by hour of day"
          >
            <div
              v-for="item in data?.captureByHour ?? []"
              :key="item.hour"
              class="flex-1 bg-neutral-600 rounded-t-sm motion-safe:transition-all motion-safe:duration-300"
              :style="{ height: barHeightPct(item.count, hourMaxCount) }"
              :aria-label="`Hour ${item.hour}: ${item.count}`"
              :title="`${item.hour}:00 — ${item.count} captures`"
            />
          </div>
          <!-- Sparse labels at 0, 6, 12, 18 -->
          <div class="relative h-4 mt-1 text-[10px] bd-faint tabular-nums select-none">
            <span class="absolute" style="left: 0%">0</span>
            <span class="absolute" style="left: 25%">6</span>
            <span class="absolute" style="left: 50%">12</span>
            <span class="absolute" style="left: 75%">18</span>
          </div>
        </section>

        <!-- ── By project table ───────────────────────────────────────── -->
        <section
          v-if="(data?.byProject ?? []).length > 0"
          aria-label="Stats by project"
        >
          <h2 class="text-xs font-semibold tracking-widest uppercase bd-faint mb-3">
            By project
          </h2>
          <div class="border bd-border rounded overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bd-border bd-surface">
                  <th class="px-4 py-2 text-left text-xs font-medium bd-faint" scope="col">Project</th>
                  <th class="px-4 py-2 text-right text-xs font-medium bd-faint tabular-nums" scope="col">Todos</th>
                  <th class="px-4 py-2 text-right text-xs font-medium bd-faint tabular-nums" scope="col">Events</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-800 bd-bg">
                <tr
                  v-for="row in data?.byProject ?? []"
                  :key="row.project"
                  class="bd-hover motion-safe:transition-colors"
                >
                  <td class="px-4 py-2.5 flex items-center gap-2">
                    <!-- Color tick -->
                    <span
                      class="w-0.5 h-4 rounded-full shrink-0"
                      :style="{ backgroundColor: row.color || '#a3a3a3' }"
                      aria-hidden="true"
                    />
                    <span class="bd-text truncate max-w-[180px]">{{ row.project }}</span>
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums bd-muted">{{ row.todos }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums bd-muted">{{ row.events }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
