<script setup lang="ts">
import { computed } from "vue";
import {
  blockStyle,
  packColumns,
  tint,
  solid,
  dayMarkerKey,
  localDayKey,
} from "~/composables/calendarLayout";
import type { CalEvent, CalTodo } from "~/composables/useCalendarFeed";

const props = defineProps<{
  /** UTC-midnight marker for this column's calendar date. */
  day: Date;
  events: CalEvent[];
  scheduledTodos: CalTodo[];
  projectColorMap: Record<string, string>;
  /** Shared "now" instant from the timeline; used for the today-column tint. */
  today: Date;
}>();

const isToday = computed(() => dayMarkerKey(props.day) === localDayKey(props.today));

const positionedEvents = computed(() =>
  packColumns(
    props.events
      .map((e) => ({ ...e, _start: new Date(e.startsAt), _end: new Date(e.endsAt) }))
      .filter((e) => localDayKey(e._start) === dayMarkerKey(props.day)),
  ),
);

const todos = computed(() =>
  props.scheduledTodos
    .filter((t) => t.scheduledStart != null)
    .map((t) => ({
      ...t,
      _start: new Date(t.scheduledStart!),
      _end: new Date(t.scheduledEnd ?? t.scheduledStart!),
    }))
    .filter((t) => localDayKey(t._start) === dayMarkerKey(props.day)),
);
</script>

<template>
  <div class="relative h-full">
    <!-- Today column tint -->
    <div
      v-if="isToday"
      class="absolute inset-0 pointer-events-none"
      style="background-color: rgba(255, 255, 255, 0.025)"
    />

    <!-- Events -->
    <div
      v-for="ev in positionedEvents"
      :key="ev.id"
      class="absolute rounded px-1.5 overflow-hidden border-l-2"
      :style="{ ...blockStyle(ev._start, ev._end, ev._col, ev._ncols), backgroundColor: tint(ev.color), borderLeftColor: solid(ev.color) }"
    >
      <p class="text-[11px] leading-tight truncate pl-1.5 pt-0.5 bd-text">{{ ev.title }}</p>
      <p class="text-[10px] tabular-nums bd-muted pl-1.5">
        {{ ev._start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }}
      </p>
    </div>

    <!-- Scheduled todos -->
    <div
      v-for="todo in todos"
      :key="todo.id"
      class="absolute rounded px-1.5 overflow-hidden border border-dashed bd-border bd-surface-2"
      :style="blockStyle(todo._start, todo._end)"
    >
      <div
        v-if="todo.projectId && projectColorMap[todo.projectId]"
        class="absolute left-0 top-0 bottom-0 w-0.5"
        :style="{ backgroundColor: projectColorMap[todo.projectId] }"
      />
      <p class="text-[11px] leading-tight truncate pl-1.5 pt-0.5 bd-muted">{{ todo.title }}</p>
    </div>
  </div>
</template>
