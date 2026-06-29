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

const DEFAULT_EVENT_COLOR = "#525252"; // neutral-600 for events with no calendar color

// Translucent fill from a hex color so the title stays readable on a light tint.
function tint(hex: string | null | undefined): string {
  return `${hex ?? DEFAULT_EVENT_COLOR}22`;
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

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function minutesFromMidnight(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function blockStyle(start: Date, end: Date): Record<string, string> {
  const top = (minutesFromMidnight(start) / 60) * HOUR_HEIGHT_PX;
  const height = Math.max(
    ((end.getTime() - start.getTime()) / 3_600_000) * HOUR_HEIGHT_PX,
    18, // minimum 18px so 0-minute events are visible
  );
  return {
    top: `${top}px`,
    height: `${height}px`,
  };
}

const eventsByDay = computed(() =>
  props.days.map((day) =>
    props.events
      .map((e) => ({ ...e, _start: new Date(e.startsAt), _end: new Date(e.endsAt) }))
      .filter((e) => isSameDay(e._start, day)),
  ),
);

const allDayByDay = computed(() =>
  props.days.map((day) =>
    (props.allDayEvents ?? [])
      .map((e) => ({ ...e, _start: new Date(e.startsAt) }))
      .filter((e) => isSameDay(e._start, day)),
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
      .filter((t) => isSameDay(t._start, day)),
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
  return isSameDay(d, today.value);
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Day header row -->
    <div class="grid border-b border-neutral-200 bg-white" :style="{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }">
      <!-- gutter -->
      <div class="border-r border-neutral-200" />
      <div
        v-for="(day, i) in days"
        :key="day.toISOString()"
        class="border-r border-neutral-200 px-2 py-2 text-center"
        :class="isToday(day) ? 'text-neutral-900 font-semibold' : 'text-neutral-400'"
      >
        <p class="text-[10px] uppercase tracking-widest">{{ DAY_LABELS[i] }}</p>
        <p class="text-base tabular-nums leading-tight">{{ labelDate(day).split(" ")[1] }}</p>
      </div>
    </div>

    <!-- All-day row -->
    <div
      v-if="(allDayEvents?.length ?? 0) > 0"
      class="grid border-b border-neutral-200 bg-white"
      :style="{ gridTemplateColumns: `3rem repeat(${days.length}, 1fr)` }"
    >
      <div class="border-r border-neutral-200 flex items-center justify-end pr-2">
        <span class="text-[9px] uppercase tracking-widest text-neutral-300">All day</span>
      </div>
      <div
        v-for="(day, colIdx) in days"
        :key="day.toISOString()"
        class="border-r border-neutral-200 px-1 py-1 flex flex-col gap-0.5 min-h-[1.75rem]"
      >
        <div
          v-for="ev in allDayByDay[colIdx]"
          :key="ev.id"
          class="rounded px-1.5 py-0.5 text-[10px] leading-tight truncate border-l-2"
          :style="{ backgroundColor: tint(ev.color), borderLeftColor: solid(ev.color), color: '#404040' }"
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
        <div class="relative border-r border-neutral-200">
          <div
            v-for="h in HOURS"
            :key="h"
            class="absolute w-full border-t border-neutral-100"
            :style="{ top: `${h * HOUR_HEIGHT_PX}px` }"
          >
            <span class="block text-right pr-2 text-[10px] tabular-nums text-neutral-300 -mt-2.5">
              {{ h === 0 ? "" : formatHour(h) }}
            </span>
          </div>
        </div>

        <!-- Day columns -->
        <div
          v-for="(day, colIdx) in days"
          :key="day.toISOString()"
          class="relative border-r border-neutral-200"
        >
          <!-- Hour grid lines -->
          <div
            v-for="h in HOURS"
            :key="h"
            class="absolute w-full border-t border-neutral-100"
            :style="{ top: `${h * HOUR_HEIGHT_PX}px`, height: `${HOUR_HEIGHT_PX}px` }"
          />

          <!-- Today highlight -->
          <div
            v-if="isToday(day)"
            class="absolute inset-0 bg-neutral-50 pointer-events-none"
          />

          <!-- Events -->
          <div
            v-for="ev in eventsByDay[colIdx]"
            :key="ev.id"
            class="absolute left-0.5 right-0.5 rounded px-1.5 overflow-hidden border-l-2"
            :style="{ ...blockStyle(ev._start, ev._end), backgroundColor: tint(ev.color), borderLeftColor: solid(ev.color) }"
          >
            <p class="text-[11px] leading-tight truncate pl-1.5 pt-0.5 text-neutral-800">
              {{ ev.title }}
            </p>
            <p class="text-[10px] tabular-nums text-neutral-500 pl-1.5">
              {{ ev._start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) }}
            </p>
          </div>

          <!-- Scheduled todos -->
          <div
            v-for="todo in todosByDay[colIdx]"
            :key="todo.id"
            class="absolute left-0.5 right-0.5 rounded px-1.5 overflow-hidden border border-neutral-200 bg-neutral-50"
            :style="blockStyle(todo._start, todo._end)"
          >
            <div
              v-if="todo.projectId && projectColorMap[todo.projectId]"
              class="absolute left-0 top-0 bottom-0 w-0.5"
              :style="{ backgroundColor: projectColorMap[todo.projectId] }"
            />
            <p class="text-[11px] leading-tight truncate pl-1.5 pt-0.5 text-neutral-600">
              {{ todo.title }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
