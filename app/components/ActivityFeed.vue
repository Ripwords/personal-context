<script setup lang="ts">
interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
}

interface UndoResult {
  undone: boolean;
  action?: string;
  entityType?: string;
}

const toast = useToast();

const {
  data: rows,
  refresh,
  status,
} = useFetch<ActivityRow[]>("/api/activity");

defineExpose({ refresh });

const undoing = ref<boolean>(false);

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

async function undoLast(): Promise<void> {
  undoing.value = true;
  try {
    const result = await $fetch<UndoResult>("/api/undo", { method: "POST" });
    if (result.undone) {
      toast.add({ title: `Undid last ${result.entityType ?? "action"}`, color: "neutral" });
    } else {
      toast.add({ title: "Nothing to undo", color: "neutral" });
    }
    await refresh();
  } catch {
    toast.add({ title: "Undo failed", color: "neutral" });
  } finally {
    undoing.value = false;
  }
}
</script>

<template>
  <section aria-label="Recent activity" class="flex flex-col gap-4">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <h2 class="text-xs font-semibold tracking-widest uppercase bd-faint">
        Activity
      </h2>
      <button
        type="button"
        :disabled="undoing || (rows ?? []).length === 0"
        class="px-2 py-1 rounded text-xs font-medium border bd-border
               bd-muted bd-surface bd-hover disabled:opacity-40 disabled:cursor-not-allowed
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500
               motion-safe:transition-colors"
        @click="undoLast"
      >
        {{ undoing ? "Undoing…" : "Undo last" }}
      </button>
    </div>

    <!-- Loading -->
    <p v-if="status === 'pending'" class="text-sm bd-faint">
      Loading…
    </p>

    <!-- Empty -->
    <p v-else-if="!rows || rows.length === 0" class="text-sm bd-faint">
      No activity yet.
    </p>

    <!-- List -->
    <ul v-else class="flex flex-col gap-1">
      <li
        v-for="row in rows"
        :key="row.id"
        class="flex items-baseline gap-2 py-1.5 border-b bd-border last:border-b-0"
      >
        <!-- Action -->
        <span class="text-sm bd-muted capitalize">{{ row.action }}</span>

        <!-- Entity type badge -->
        <span
          class="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider
                 border bd-border rounded bd-faint bd-bg"
        >
          {{ row.entityType }}
        </span>

        <!-- Time -->
        <span class="ml-auto text-xs tabular-nums bd-faint shrink-0">
          {{ relativeTime(row.createdAt) }}
        </span>
      </li>
    </ul>
  </section>
</template>
