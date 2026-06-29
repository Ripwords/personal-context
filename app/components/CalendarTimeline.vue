<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { startOfWeek, addDays } from "~/composables/useWeek";
import {
  HOUR_HEIGHT_PX,
  GRID_HEIGHT_PX,
  HOURS,
  formatHour,
  tint,
  solid,
  dayMarkerKey,
  localDayKey,
  utcDayKey,
  visibleDayRange,
  centerDayIndex,
} from "~/composables/calendarLayout";
import CalendarDayColumn from "~/components/CalendarDayColumn.vue";
import type { CalEvent, CalTodo } from "~/composables/useCalendarFeed";

const props = defineProps<{
  events: CalEvent[];
  allDayEvents: CalEvent[];
  scheduledTodos: CalTodo[];
  projectColorMap: Record<string, string>;
}>();

const emit = defineEmits<{
  /** Monday markers (incl. a one-week prefetch margin) currently in view. */
  "visible-weeks": [Date[]];
  /** Calendar date at the horizontal centre of the viewport. */
  "update:centerDate": [Date];
}>();

// ── Canvas geometry ──────────────────────────────────────────────────────────
// A bounded ±26-week strip (≈ half a year each way) anchored to a fixed origin,
// so day columns sit at absolute offsets and virtualization never needs to
// compensate scrollLeft when the rendered window shifts.
const RANGE_WEEKS = 26;
const TOTAL_DAYS = (RANGE_WEEKS * 2 + 1) * 7;
const THIS_MONDAY_IDX = RANGE_WEEKS * 7;
const BUFFER = 3; // extra day columns rendered on each side
const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localTodayMarker(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
const origin = addDays(startOfWeek(localTodayMarker()), -RANGE_WEEKS * 7);

const hScroll = ref<HTMLElement | null>(null);
const headerScroll = ref<HTMLElement | null>(null);
const allDayScroll = ref<HTMLElement | null>(null);
const gutterScroll = ref<HTMLElement | null>(null);

const scrollLeft = ref(0);
const scrollTop = ref(0);
const viewW = ref(0);

const dayWidth = computed(() => (viewW.value > 0 ? viewW.value / 7 : 0));
const totalW = computed(() => dayWidth.value * TOTAL_DAYS);

interface DayCell {
  idx: number;
  date: Date;
  left: number;
  weekday: string;
  dayNum: number;
  isToday: boolean;
}

const visibleDays = computed<DayCell[]>(() => {
  const { start, end } = visibleDayRange(scrollLeft.value, viewW.value, dayWidth.value, TOTAL_DAYS, BUFFER);
  const cells: DayCell[] = [];
  for (let i = start; i <= end; i++) {
    const date = addDays(origin, i);
    cells.push({
      idx: i,
      date,
      left: i * dayWidth.value,
      weekday: SHORT_DAY[date.getUTCDay()]!,
      dayNum: date.getUTCDate(),
      isToday: dayMarkerKey(date) === localDayKey(today.value),
    });
  }
  return cells;
});

const allDayByIdx = computed(() => {
  const map = new Map<number, CalEvent[]>();
  for (const cell of visibleDays.value) {
    map.set(
      cell.idx,
      props.allDayEvents.filter((e) => utcDayKey(new Date(e.startsAt)) === dayMarkerKey(cell.date)),
    );
  }
  return map;
});

const hasAllDay = computed(() => props.allDayEvents.length > 0);

// The all-day band grows to fit the busiest day in view (its cells are absolutely
// positioned, so they can't size the band themselves — otherwise stacked all-day
// events get crushed into one row).
const ALL_DAY_ROW_PX = 20; // one stacked all-day chip incl. gap
const allDayBandHeight = computed(() => {
  let maxRows = 1;
  for (const evs of allDayByIdx.value.values()) maxRows = Math.max(maxRows, evs.length);
  return maxRows * ALL_DAY_ROW_PX + 8; // + vertical padding
});

// Weeks to keep loaded: visible range padded by a week on each side for prefetch.
const prefetchWeeks = computed<Date[]>(() => {
  const { start, end } = visibleDayRange(scrollLeft.value, viewW.value, dayWidth.value, TOTAL_DAYS, BUFFER);
  const lo = Math.max(0, start - 7);
  const hi = Math.min(TOTAL_DAYS - 1, end + 7);
  const byKey = new Map<string, Date>();
  for (let i = lo; i <= hi; i++) {
    const mon = startOfWeek(addDays(origin, i));
    byKey.set(mon.toISOString(), mon);
  }
  return [...byKey.values()];
});
// Don't emit until the scroll has been positioned on today — before that the
// window/centre reflect the far-past origin (scrollLeft 0), not the real view.
const positioned = ref(false);
watch(prefetchWeeks, (w) => positioned.value && emit("visible-weeks", w), { immediate: false });

const centerDate = computed(() =>
  addDays(origin, centerDayIndex(scrollLeft.value, viewW.value, dayWidth.value, TOTAL_DAYS)),
);
watch(centerDate, (d) => positioned.value && emit("update:centerDate", d), { immediate: false });

// ── "Now" indicator ──────────────────────────────────────────────────────────
const today = ref(new Date());
let todayTimer: ReturnType<typeof setInterval> | undefined;
const todayIdx = computed(() =>
  Math.round((localTodayMarker().getTime() - origin.getTime()) / 86_400_000),
);
const nowTop = computed(
  () => ((today.value.getHours() * 60 + today.value.getMinutes()) / 60) * HOUR_HEIGHT_PX,
);
const nowLabel = computed(() =>
  today.value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
);

// ── Scroll synchronization ───────────────────────────────────────────────────
function syncFromScroller(): void {
  const el = hScroll.value;
  if (!el) return;
  scrollLeft.value = el.scrollLeft;
  scrollTop.value = el.scrollTop;
  if (headerScroll.value) headerScroll.value.scrollLeft = el.scrollLeft;
  if (allDayScroll.value) allDayScroll.value.scrollLeft = el.scrollLeft;
  if (gutterScroll.value) gutterScroll.value.scrollTop = el.scrollTop;
}

// True once we've landed the initial scroll on today with a real (non-zero)
// width. Until then, any width we get is the moment to jump to today.
let initialized = false;

/**
 * Land this week's Monday at the left edge — the default "today" position.
 * Deferred to nextTick so the inner canvas has re-rendered to its real width
 * first; otherwise the browser clamps scrollLeft to 0 (the far-past origin).
 */
function centerToday(): void {
  if (dayWidth.value <= 0) return;
  nextTick(() => {
    const el = hScroll.value;
    if (!el || dayWidth.value <= 0) return;
    el.scrollLeft = THIS_MONDAY_IDX * dayWidth.value;
    positioned.value = true; // now scroll-driven emits reflect the real view
    syncFromScroller();
  });
}

function onResize(): void {
  const el = hScroll.value;
  if (!el) return;
  const newW = el.clientWidth;
  if (newW <= 0) return;
  // Ignore non-width changes (e.g. the all-day band growing taller) — only a
  // real width change should reflow the horizontal position.
  if (initialized && newW === viewW.value) return;

  if (!initialized) {
    // First real width: jump to today (handles a zero-width mount during hydration).
    viewW.value = newW;
    centerToday();
    initialized = true;
    return;
  }

  // Genuine resize: keep the centred day put.
  const prevCenter = centerDayIndex(scrollLeft.value, viewW.value, dayWidth.value, TOTAL_DAYS);
  viewW.value = newW;
  nextTick(() => {
    el.scrollLeft = Math.max(0, prevCenter * dayWidth.value - viewW.value / 2);
    syncFromScroller();
  });
}

// ── Pointer drag-to-pan (free, no snapping) ──────────────────────────────────
let dragging = false;
let axis: "x" | "y" | null = null;
let startX = 0;
let startY = 0;
let startLeft = 0;
let startTop = 0;

function onPointerdown(e: PointerEvent): void {
  if (e.button !== 0 || !hScroll.value) return;
  dragging = true;
  axis = null;
  startX = e.clientX;
  startY = e.clientY;
  startLeft = hScroll.value.scrollLeft;
  startTop = hScroll.value.scrollTop;
  window.addEventListener("pointermove", onPointermove);
  window.addEventListener("pointerup", onPointerup);
}

function onPointermove(e: PointerEvent): void {
  const el = hScroll.value;
  if (!dragging || !el) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (axis === null) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
  }
  e.preventDefault();
  if (axis === "x") el.scrollLeft = startLeft - dx;
  else el.scrollTop = startTop - dy;
}

function onPointerup(): void {
  dragging = false;
  axis = null;
  window.removeEventListener("pointermove", onPointermove);
  window.removeEventListener("pointerup", onPointerup);
}

// ── Imperative navigation (header buttons) ───────────────────────────────────
function next(): void {
  hScroll.value?.scrollBy({ left: 7 * dayWidth.value, behavior: "smooth" });
}
function prev(): void {
  hScroll.value?.scrollBy({ left: -7 * dayWidth.value, behavior: "smooth" });
}
function goToToday(): void {
  hScroll.value?.scrollTo({ left: THIS_MONDAY_IDX * dayWidth.value, behavior: "smooth" });
}
defineExpose({ prev, next, goToToday });

// ── Lifecycle ────────────────────────────────────────────────────────────────
let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  const el = hScroll.value;
  if (!el) return;
  viewW.value = el.clientWidth;
  // If we already have a real width, land on today now; otherwise onResize will
  // do it as soon as the ResizeObserver reports a non-zero width.
  if (viewW.value > 0) {
    centerToday();
    initialized = true;
  }
  resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(el);
  todayTimer = setInterval(() => {
    today.value = new Date();
  }, 60_000);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  clearInterval(todayTimer);
  window.removeEventListener("pointermove", onPointermove);
  window.removeEventListener("pointerup", onPointerup);
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bd-bg select-none">
    <!-- Day header row: corner + horizontally-synced day labels -->
    <div class="flex border-b bd-border bd-surface shrink-0">
      <div class="w-12 shrink-0 border-r bd-border" />
      <div ref="headerScroll" class="flex-1 overflow-hidden">
        <div class="relative h-[3.25rem]" :style="{ width: `${totalW}px` }">
          <div
            v-for="cell in visibleDays"
            :key="cell.idx"
            class="absolute top-0 bottom-0 border-r bd-border px-1 py-2 text-center"
            :style="{ left: `${cell.left}px`, width: `${dayWidth}px` }"
          >
            <p class="text-[10px] uppercase tracking-widest" :class="cell.isToday ? 'bd-accent' : 'bd-faint'">
              {{ cell.weekday }}
            </p>
            <p
              class="text-base tabular-nums leading-tight mt-0.5 inline-flex items-center justify-center min-w-7 h-7 rounded-full"
              :class="cell.isToday ? 'text-white font-semibold' : 'bd-muted'"
              :style="cell.isToday ? { backgroundColor: 'var(--bd-accent)' } : {}"
            >
              {{ cell.dayNum }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- All-day band (always present so the hour grid below stays seam-aligned) -->
    <div v-if="hasAllDay" class="flex border-b bd-border bd-surface shrink-0">
      <div class="w-12 shrink-0 border-r bd-border flex items-center justify-end pr-2">
        <span class="text-[9px] uppercase tracking-widest bd-faint">All day</span>
      </div>
      <div ref="allDayScroll" class="flex-1 overflow-hidden">
        <div class="relative" :style="{ width: `${totalW}px`, height: `${allDayBandHeight}px` }">
          <div
            v-for="cell in visibleDays"
            :key="cell.idx"
            class="absolute top-0 bottom-0 border-r bd-border px-1 py-1 flex flex-col gap-0.5"
            :style="{ left: `${cell.left}px`, width: `${dayWidth}px` }"
          >
            <div
              v-for="ev in allDayByIdx.get(cell.idx) ?? []"
              :key="ev.id"
              class="rounded px-1.5 py-0.5 text-[10px] leading-tight truncate border-l-2 bd-text"
              :style="{ backgroundColor: tint(ev.color), borderLeftColor: solid(ev.color) }"
              :title="ev.title"
            >
              {{ ev.title }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Body: hour gutter + horizontally-scrolling day grid -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Gutter (vertical-synced to the grid) -->
      <div ref="gutterScroll" class="w-12 shrink-0 overflow-hidden border-r bd-border relative">
        <div class="relative" :style="{ height: `${GRID_HEIGHT_PX}px` }">
          <div
            v-for="h in HOURS"
            :key="h"
            class="absolute w-full"
            :style="{ top: `${h * HOUR_HEIGHT_PX}px` }"
          >
            <span class="block text-right pr-2 text-[10px] tabular-nums bd-faint -mt-2.5">
              {{ h === 0 ? "" : formatHour(h) }}
            </span>
          </div>
          <!-- now time label -->
          <div
            class="absolute right-1 flex justify-end"
            :style="{ top: `${nowTop}px` }"
          >
            <span
              class="text-[10px] tabular-nums font-semibold text-white rounded px-1 leading-tight -mt-2"
              style="background-color: var(--bd-accent)"
            >{{ nowLabel }}</span>
          </div>
        </div>
      </div>

      <!-- Scrollable day strip -->
      <div
        ref="hScroll"
        class="flex-1 overflow-x-auto overflow-y-auto relative timeline-scroll cursor-grab active:cursor-grabbing"
        @scroll="syncFromScroller"
        @pointerdown="onPointerdown"
      >
        <div class="relative" :style="{ width: `${totalW}px`, height: `${GRID_HEIGHT_PX}px` }">
          <!-- Hour grid lines spanning the full strip -->
          <div
            v-for="h in HOURS"
            :key="h"
            class="absolute left-0 border-t bd-border opacity-60"
            :style="{ top: `${h * HOUR_HEIGHT_PX}px`, width: `${totalW}px` }"
          />

          <!-- Virtualized day columns -->
          <div
            v-for="cell in visibleDays"
            :key="cell.idx"
            class="absolute top-0 border-r bd-border"
            :style="{ left: `${cell.left}px`, width: `${dayWidth}px`, height: `${GRID_HEIGHT_PX}px` }"
          >
            <CalendarDayColumn
              :day="cell.date"
              :events="events"
              :scheduled-todos="scheduledTodos"
              :project-color-map="projectColorMap"
              :today="today"
            />
          </div>

          <!-- Current-time line, drawn within today's column -->
          <div
            class="absolute z-10 pointer-events-none"
            :style="{ left: `${todayIdx * dayWidth}px`, width: `${dayWidth}px`, top: `${nowTop}px` }"
          >
            <div class="relative">
              <div class="h-px w-full" style="background-color: var(--bd-accent)" />
              <div class="absolute -left-0.5 -top-1 w-2 h-2 rounded-full" style="background-color: var(--bd-accent)" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Hide scrollbars — navigation is via smooth scroll, drag, and the header buttons. */
.timeline-scroll {
  scrollbar-width: none; /* Firefox */
}
.timeline-scroll::-webkit-scrollbar {
  display: none; /* WebKit */
}
</style>
