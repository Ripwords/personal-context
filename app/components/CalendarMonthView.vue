<script setup lang="ts">
import { computed } from "vue";
import { localDayKey } from "~/composables/calendarLayout";
import type { CalEvent, CalTodo } from "~/composables/useCalendarFeed";

const props = defineProps<{
  /** Any instant within the month to render. */
  monthAnchor: Date;
  events: CalEvent[];
  scheduledTodos: CalTodo[];
  projectColorMap: Record<string, string>;
  today: Date;
}>();

const emit = defineEmits<{ "select-day": [day: Date] }>();

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Cell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  items: Array<{ id: string; title: string; color: string | null; kind: "event" | "todo" }>;
}

const cells = computed<Cell[]>(() => {
  const y = props.monthAnchor.getFullYear();
  const m = props.monthAnchor.getMonth();
  const first = new Date(y, m, 1);
  const dow = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(y, m, 1 - dow);

  // Bucket events + scheduled todos by local day for O(1) lookup.
  const byDay = new Map<string, Cell["items"]>();
  const push = (when: string, item: Cell["items"][number]) => {
    const key = localDayKey(new Date(when));
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  };
  for (const e of props.events) push(e.startsAt, { id: e.id, title: e.title, color: e.color, kind: "event" });
  for (const t of props.scheduledTodos) {
    if (t.scheduledStart) {
      push(t.scheduledStart, {
        id: t.id, title: t.title,
        color: t.projectId ? (props.projectColorMap[t.projectId] ?? null) : null,
        kind: "todo",
      });
    }
  }

  const todayKey = localDayKey(props.today);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = localDayKey(date);
    return {
      date,
      inMonth: date.getMonth() === m,
      isToday: key === todayKey,
      items: byDay.get(key) ?? [],
    };
  });
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden p-2">
    <!-- Weekday header -->
    <div class="grid grid-cols-7 gap-px shrink-0">
      <div v-for="d in WEEKDAYS" :key="d" class="text-[10px] font-semibold tracking-wide uppercase bd-faint text-center py-1">
        {{ d }}
      </div>
    </div>

    <!-- Day grid -->
    <div class="grid grid-cols-7 grid-rows-6 gap-px flex-1 min-h-0">
      <button
        v-for="cell in cells"
        :key="cell.date.toISOString()"
        type="button"
        class="flex flex-col items-start gap-0.5 p-1 text-left border bd-border rounded overflow-hidden
               motion-safe:transition-colors hover:bg-[rgba(255,255,255,0.03)]
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500"
        :class="cell.inMonth ? 'bd-surface' : 'bd-bg opacity-50'"
        @click="emit('select-day', cell.date)"
      >
        <span
          class="text-[11px] tabular-nums shrink-0"
          :class="cell.isToday ? 'font-bold bd-text bg-[var(--bd-surface-2)] rounded px-1' : 'bd-muted'"
        >
          {{ cell.date.getDate() }}
        </span>
        <span
          v-for="item in cell.items.slice(0, 3)"
          :key="item.id"
          class="w-full flex items-center gap-1 text-[10px] leading-tight bd-muted truncate"
        >
          <span class="shrink-0 w-1 h-1 rounded-full" :style="{ backgroundColor: item.color ?? '#6b7280' }" />
          <span class="truncate" :class="item.kind === 'todo' ? 'italic' : ''">{{ item.title }}</span>
        </span>
        <span v-if="cell.items.length > 3" class="text-[10px] bd-faint">+{{ cell.items.length - 3 }} more</span>
      </button>
    </div>
  </div>
</template>
