import { computed } from "vue";
import { addDays } from "~/composables/useWeek";

export interface CalEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  projectId: string | null;
  color: string | null;
  allDay: boolean;
}

export interface CalTodo {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}

interface FeedResponse {
  events: CalEvent[];
  allDayEvents: CalEvent[];
  scheduledTodos: CalTodo[];
  unscheduledTodos: CalTodo[];
}

interface WeekChunk {
  events: CalEvent[];
  allDayEvents: CalEvent[];
  scheduledTodos: CalTodo[];
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()];
}

/**
 * Lazily loads the calendar feed one ISO week at a time and merges the chunks.
 *
 * The horizontal timeline calls `ensureWeeks` with the weeks scrolling into
 * view; each missing week is fetched once (its range is padded ±1 day and
 * results are de-duped by id, so events straddling a week boundary aren't lost
 * or doubled). `/api/calendar/events` also syncs Google for the queried range,
 * so scrolling lazily syncs new territory too. `unscheduledTodos` is global, so
 * we just keep the latest response's copy.
 */
export function useCalendarFeed() {
  // Backed by useState (keyed, app-wide) so loaded weeks survive navigation —
  // returning to the calendar renders instantly from cache instead of refetching.
  const chunks = useState<Record<string, WeekChunk>>("cal:chunks", () => ({}));
  // `requested` (loaded or in-flight weeks, never refetched until reload) is a Set
  // for O(1) checks, mirrored into a persisted array so it too survives navigation.
  const requestedKeys = useState<string[]>("cal:requested", () => []);
  const requested = new Set<string>(requestedKeys.value);
  const syncRequested = () => { requestedKeys.value = [...requested]; };
  const unscheduledTodos = useState<CalTodo[]>("cal:unscheduled", () => []);
  const inFlight = useState<number>("cal:inflight", () => 0);
  const lastError = useState<{ statusCode?: number } | null>("cal:error", () => null);

  const loading = computed(() => inFlight.value > 0);
  const hasAny = computed(() => Object.keys(chunks.value).length > 0);

  const events = computed(() =>
    dedupeById(Object.values(chunks.value).flatMap((c) => c.events)),
  );
  const allDayEvents = computed(() =>
    dedupeById(Object.values(chunks.value).flatMap((c) => c.allDayEvents)),
  );
  const scheduledTodos = computed(() =>
    dedupeById(Object.values(chunks.value).flatMap((c) => c.scheduledTodos)),
  );

  async function fetchWeek(mondayMarker: Date): Promise<void> {
    const key = mondayMarker.toISOString();
    if (requested.has(key)) return;
    requested.add(key);
    syncRequested();
    inFlight.value++;
    try {
      const res = await $fetch<FeedResponse>("/api/calendar/events", {
        query: {
          from: addDays(mondayMarker, -1).toISOString(),
          to: addDays(mondayMarker, 8).toISOString(),
        },
      });
      chunks.value = {
        ...chunks.value,
        [key]: { events: res.events, allDayEvents: res.allDayEvents, scheduledTodos: res.scheduledTodos },
      };
      unscheduledTodos.value = res.unscheduledTodos;
      lastError.value = null;
    } catch (err) {
      requested.delete(key); // allow a retry when this week scrolls back into view
      syncRequested();
      lastError.value = err as { statusCode?: number };
    } finally {
      inFlight.value--;
    }
  }

  /** Fetch any of the given weeks not already loaded/in-flight. */
  function ensureWeeks(mondayMarkers: Date[]): void {
    for (const m of mondayMarkers) void fetchWeek(m);
  }

  /** Refetch every currently-loaded week — used after a mutation (dump/drop). */
  async function reload(): Promise<void> {
    const keys = [...requested];
    requested.clear();
    syncRequested();
    await Promise.all(keys.map((k) => fetchWeek(new Date(k))));
  }

  return {
    events,
    allDayEvents,
    scheduledTodos,
    unscheduledTodos,
    loading,
    hasAny,
    lastError,
    ensureWeeks,
    reload,
  };
}
