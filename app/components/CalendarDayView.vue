<script setup lang="ts">
import { ref } from "vue";
import CalendarDayColumn from "~/components/CalendarDayColumn.vue";
import { HOURS, HOUR_HEIGHT_PX, GRID_HEIGHT_PX, formatHour } from "~/composables/calendarLayout";
import type { CalEvent, CalTodo } from "~/composables/useCalendarFeed";

const props = defineProps<{
  /** UTC-midnight marker for the day to show. */
  day: Date;
  events: CalEvent[];
  scheduledTodos: CalTodo[];
  projectColorMap: Record<string, string>;
  today: Date;
}>();

const emit = defineEmits<{
  /** A todo was dropped onto the grid → schedule it at this instant. */
  "schedule-todo": [payload: { id: string; startsAt: string; endsAt: string }];
}>();

const grid = ref<HTMLElement | null>(null);
const dragOver = ref(false);

function onDrop(e: DragEvent): void {
  dragOver.value = false;
  const id = e.dataTransfer?.getData("application/x-braindump-todo");
  if (!id || !grid.value) return;

  // Y within the full-height grid → minute of day, snapped to 30-minute slots.
  const rect = grid.value.getBoundingClientRect();
  const y = Math.max(0, Math.min(GRID_HEIGHT_PX, e.clientY - rect.top));
  const totalMinutes = Math.round((y / HOUR_HEIGHT_PX) * 60 / 30) * 30;
  const hour = Math.min(23, Math.floor(totalMinutes / 60));
  const minute = totalMinutes % 60;

  // The marker is UTC-midnight; its UTC Y/M/D is the calendar date. Build the
  // dropped instant in LOCAL time so it lands on the chosen hour row.
  const start = new Date(props.day.getUTCFullYear(), props.day.getUTCMonth(), props.day.getUTCDate(), hour, minute);
  const end = new Date(start.getTime() + 30 * 60_000);
  emit("schedule-todo", { id, startsAt: start.toISOString(), endsAt: end.toISOString() });
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="flex" :style="{ height: `${GRID_HEIGHT_PX}px` }">
      <!-- Hour gutter -->
      <div class="w-14 shrink-0 relative select-none">
        <div
          v-for="h in HOURS"
          :key="h"
          class="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums bd-faint"
          :style="{ top: `${h * HOUR_HEIGHT_PX}px` }"
        >
          {{ h === 0 ? "" : formatHour(h) }}
        </div>
      </div>

      <!-- Day grid + drop target -->
      <div
        ref="grid"
        class="relative flex-1 border-l bd-border"
        :class="dragOver ? 'bg-[rgba(255,255,255,0.04)]' : ''"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <!-- Hour gridlines -->
        <div
          v-for="h in HOURS"
          :key="h"
          class="absolute left-0 right-0 border-t bd-border"
          :style="{ top: `${h * HOUR_HEIGHT_PX}px` }"
        />
        <CalendarDayColumn
          class="absolute inset-0"
          :day="day"
          :events="events"
          :scheduled-todos="scheduledTodos"
          :project-color-map="projectColorMap"
          :today="today"
        />
      </div>
    </div>
  </div>
</template>
