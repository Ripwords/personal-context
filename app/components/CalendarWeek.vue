<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";

export interface CalEvent {
  id: string;
  title: string;
  startsAt: string | Date;
  endsAt: string | Date;
  projectId: string | null;
  /** Source Google calendar color (hex), or null for local/AI events. */
  color?: string | null;
  allDay?: boolean;
}

export interface CalTodo {
  id: string;
  title: string;
  scheduledStart: string | Date | null;
  scheduledEnd: string | Date | null;
  projectId: string | null;
}

const props = defineProps<{
  days: Date[];
  events: CalEvent[];
  allDayEvents?: CalEvent[];
  scheduledTodos: CalTodo[];
  projectColorMap: Record<string, string>;
}>();

const DEFAULT_EVENT_COLOR = "#6b7280"; // neutral for events with no calendar color

// Translucent fill from a hex color — readable as a colored block on the dark grid.
function tint(hex: string | null | undefined): string {
  return `${hex ?? DEFAULT_EVENT_COLOR}33`;
}
function solid(hex: string | null | undefined): string {
  return hex ?? DEFAULT_EVENT_COLOR;
}

const HOUR_HEIGHT_PX = 48; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// `day` columns come from useWeek as UTC-midnight markers for a calendar date.
function dayMarkerKey(day: Date): string {
  return `${day.getUTCFullYear()}-${day.getUTCMonth()}-${day.getUTCDate()}`;
}
// Timed events / todos / "today" are absolute instants — bucket them by the
// viewer's LOCAL calendar date so a 9 AM event lands on the 9 AM row of its day.
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
// All-day events are floating dates stored at UTC midnight — match by UTC date
// so they don't shift a day in either direction.
function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes(); // local time-of-day
}

// Vertical placement (top/height) + horizontal placement (left/width) for an
// event that shares its time slot with `ncols` columns, sitting in column `col`.
function blockStyle(start: Date, end: Date, col = 0, ncols = 1): Record<string, string> {
  const top = (minutesFromMidnight(start) / 60) * HOUR_HEIGHT_PX;
  const height = Math.max(
    ((end.getTime() - start.getTime()) / 3_600_000) * HOUR_HEIGHT_PX,
    18, // minimum 18px so 0-minute events are visible
  );
  const gap = 2; // px between side-by-side events
  const widthPct = 100 / ncols;
  return {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${col * widthPct}% + ${col === 0 ? 2 : gap / 2}px)`,
    width: `calc(${widthPct}% - ${ncols === 1 ? 4 : gap}px)`,
  };
}

// Assign overlapping events to side-by-side columns (Google-Calendar style):
// build clusters of transitively-overlapping events, then place each in the
// first free column; every event in a cluster shares the cluster's column count.
type Positioned<T> = T & { _col: number; _ncols: number };
function packColumns<T extends { _start: Date; _end: Date }>(evs: T[]): Positioned<T>[] {
  const items = [...evs].sort(
    (a, b) => a._start.getTime() - b._start.getTime() || a._end.getTime() - b._end.getTime(),
  );
  const out: Positioned<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = []; // end time of the last event placed in each column
    const colOf = new Map<T, number>();
    for (const it of cluster) {
      let placed = false;
      for (let i = 0; i < colEnds.length; i++) {
        if (it._start.getTime() >= colEnds[i]!) {
          colOf.set(it, i);
          colEnds[i] = it._end.getTime();
          placed = true;
          break;
        }
      }
      if (!placed) {
        colOf.set(it, colEnds.length);
        colEnds.push(it._end.getTime());
      }
    }
    const ncols = colEnds.length;
    for (const it of cluster) out.push({ ...it, _col: colOf.get(it)!, _ncols: ncols });
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const it of items) {
    if (cluster.length && it._start.getTime() >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it._end.getTime());
  }
  if (cluster.length) flush();
  return out;
}

const eventsByDay = computed(() =>
  props.days.map((day) =>
    packColumns(
      props.events
        .map((e) => ({ ...e, _start: new Date(e.startsAt), _end: new Date(e.endsAt) }))
        .filter((e) => localDayKey(e._start) === dayMarkerKey(day)),
    ),
  ),
);

const allDayByDay = computed(() =>
  props.days.map((day) =>
    (props.allDayEvents ?? [])
      .map((e) => ({ ...e, _start: new Date(e.startsAt) }))
      .filter((e) => utcDayKey(e._start) === dayMarkerKey(day)),
  ),
);

const todosByDay = computed(() =>
  props.days.map((day) =>
    props.scheduledTodos
      .filter((t) => t.scheduledStart != null)
      .map((t) => ({
        ...t,
        _start: new Date(t.scheduledStart!),
        _end: new Date(t.scheduledEnd ?? t.scheduledStart!),
      }))
      .filter((t) => localDayKey(t._start) === dayMarkerKey(day)),
  ),
);

function labelDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const today = ref(new Date());
let todayInterval: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  todayInterval = setInterval(() => {
    today.value = new Date();
  }, 60_000);
});

onBeforeUnmount(() => {
  clearInterval(todayInterval);
});

function isToday(d: Date): boolean {
  return dayMarkerKey(d) === localDayKey(today.value);
}

// Current-time red line (Notion-style), shown only when the visible week is the
// one containing today.
const weekHasToday = computed(() => props.days.some((d) => isToday(d)));
const nowTop = computed(
  () => ((today.value.getHours() * 60 + today.value.getMinutes()) / 60) * HOUR_HEIGHT_PX,
);
const nowLabel = computed(() =>
  today.value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
);
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bd-bg">
    <!-- Day header row -->
    <div class="grid border-b bd-border bd-surface" :style="{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }">
      <!-- gutter -->
      <div class="border-r bd-border" />
      <div
        v-for="(day, i) in days"
        :key="day.toISOString()"
        class="border-r bd-border px-2 py-2 text-center"
      >
        <p class="text-[10px] uppercase tracking-widest" :class="isToday(day) ? 'bd-accent' : 'bd-faint'">{{ DAY_LABELS[i] }}</p>
        <p
          class="text-base tabular-nums leading-tight mt-0.5 inline-flex items-center justify-center min-w-7 h-7 rounded-full"
          :class="isToday(day) ? 'text-white font-semibold' : 'bd-muted'"
          :style="isToday(day) ? { backgroundColor: 'var(--bd-accent)' } : {}"
        >{{ labelDate(day).split(" ")[1] }}</p>
      </div>
    </div>

    <!-- All-day row -->
    <div
      v-if="(allDayEvents?.length ?? 0) > 0"
      class="grid border-b bd-border bd-surface"
      :style="{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }"
    >
      <div class="border-r bd-border flex items-center justify-end pr-2">
        <span class="text-[9px] uppercase tracking-widest bd-faint">All day</span>
      </div>
      <div
        v-for="(day, colIdx) in days"
        :key="day.toISOString()"
        class="border-r bd-border px-1 py-1 flex flex-col gap-0.5 min-h-[1.75rem]"
      >
        <div
          v-for="ev in allDayByDay[colIdx]"
          :key="ev.id"
          class="rounded px-1.5 py-0.5 text-[10px] leading-tight truncate border-l-2 bd-text"
          :style="{ backgroundColor: tint(ev.color), borderLeftColor: solid(ev.color) }"
          :title="ev.title"
        >
          {{ ev.title }}
        </div>
      </div>
    </div>

    <!-- Scrollable time grid -->
    <div class="flex-1 overflow-y-auto">
      <div
        class="grid relative"
        :style="{
          gridTemplateColumns: `3rem repeat(${days.length}, 1fr)`,
          height: `${HOUR_HEIGHT_PX * 24}px`,
        }"
      >
        <!-- Hour labels column -->
        <div class="relative border-r bd-border">
          <div
            v-for="h in HOURS"
            :key="h"
            class="absolute w-full border-t bd-border opacity-60"
            :style="{ top: `${h * HOUR_HEIGHT_PX}px` }"
          >
            <span class="block text-right pr-2 text-[10px] tabular-nums bd-faint -mt-2.5">
              {{ h === 0 ? "" : formatHour(h) }}
            </span>
          </div>
        </div>

        <!-- Day columns -->
        <div
          v-for="(day, colIdx) in days"
          :key="day.toISOString()"
          class="relative border-r bd-border"
        >
          <!-- Hour grid lines -->
          <div
            v-for="h in HOURS"
            :key="h"
            class="absolute w-full border-t bd-border opacity-60"
            :style="{ top: `${h * HOUR_HEIGHT_PX}px`, height: `${HOUR_HEIGHT_PX}px` }"
          />

          <!-- Today column tint -->
          <div
            v-if="isToday(day)"
            class="absolute inset-0 pointer-events-none"
            style="background-color: rgba(255,255,255,0.025)"
          />

          <!-- Events -->
          <div
            v-for="ev in eventsByDay[colIdx]"
            :key="ev.id"
            class="absolute rounded px-1.5 overflow-hidden border-l-2"
            :style="{ ...blockStyle(ev._start, ev._end, ev._col, ev._ncols), backgroundColor: tint(ev.color), borderLeftColor: solid(ev.color) }"
          >
            <p class="text-[11px] leading-tight truncate pl-1.5 pt-0.5 bd-text">
              {{ ev.title }}
            </p>
            <p class="text-[10px] tabular-nums bd-muted pl-1.5">
              {{ ev._start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }}
            </p>
          </div>

          <!-- Scheduled todos -->
          <div
            v-for="todo in todosByDay[colIdx]"
            :key="todo.id"
            class="absolute rounded px-1.5 overflow-hidden border border-dashed bd-border bd-surface-2"
            :style="blockStyle(todo._start, todo._end)"
          >
            <div
              v-if="todo.projectId && projectColorMap[todo.projectId]"
              class="absolute left-0 top-0 bottom-0 w-0.5"
              :style="{ backgroundColor: projectColorMap[todo.projectId] }"
            />
            <p class="text-[11px] leading-tight truncate pl-1.5 pt-0.5 bd-muted">
              {{ todo.title }}
            </p>
          </div>
        </div>

        <!-- Current-time red line -->
        <div
          v-if="weekHasToday"
          class="absolute left-0 right-0 z-10 flex items-center pointer-events-none"
          :style="{ top: `${nowTop}px` }"
        >
          <div class="w-12 shrink-0 flex justify-end pr-1">
            <span
              class="text-[10px] tabular-nums font-semibold text-white rounded px-1 leading-tight"
              style="background-color: var(--bd-accent)"
            >{{ nowLabel }}</span>
          </div>
          <div class="relative flex-1">
            <div class="h-px w-full" style="background-color: var(--bd-accent)" />
            <div class="absolute -left-0.5 -top-1 w-2 h-2 rounded-full" style="background-color: var(--bd-accent)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
