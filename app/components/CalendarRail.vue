<script setup lang="ts">
import { computed } from "vue";

interface GoogleCal {
  id: string;
  accountId: string;
  summary: string;
  color: string | null;
  selected: boolean;
  primary: boolean;
}

const emit = defineEmits<{ changed: [] }>();

const { data: calendars, refresh } = await useFetch<GoogleCal[]>("/api/calendars", {
  default: () => [] as GoogleCal[],
});

// Group calendars by account; label each group with the account's primary
// calendar id (which is its email).
const groups = computed(() => {
  const byAccount = new Map<string, GoogleCal[]>();
  for (const c of calendars.value ?? []) {
    const list = byAccount.get(c.accountId) ?? [];
    list.push(c);
    byAccount.set(c.accountId, list);
  }
  return [...byAccount.entries()].map(([accountId, cals]) => ({
    accountId,
    label: cals.find((c) => c.primary)?.summary ?? cals.find((c) => c.primary)?.id ?? "Account",
    cals,
  }));
});

async function toggle(cal: GoogleCal): Promise<void> {
  cal.selected = !cal.selected; // optimistic
  try {
    await $fetch(`/api/calendars/${cal.id}`, { method: "PATCH", body: { selected: cal.selected } });
    emit("changed");
  } catch {
    cal.selected = !cal.selected; // revert on failure
  }
}

defineExpose({ refresh });
</script>

<template>
  <div class="flex flex-col gap-4 px-3 py-4">
    <p class="text-[10px] font-semibold tracking-widest uppercase bd-faint px-2">
      Calendars
    </p>

    <div v-if="groups.length === 0" class="px-2 text-xs bd-faint">
      No calendars synced yet.
    </div>

    <div v-for="g in groups" :key="g.accountId" class="flex flex-col gap-0.5">
      <p class="text-[10px] bd-faint truncate px-2 mb-0.5" :title="g.label">{{ g.label }}</p>
      <button
        v-for="cal in g.cals"
        :key="cal.id"
        type="button"
        class="flex items-center gap-2 px-2 py-1 rounded text-left text-xs bd-muted bd-hover
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500
               motion-safe:transition-colors"
        @click="toggle(cal)"
      >
        <span
          class="shrink-0 w-3 h-3 rounded-[3px] border"
          :style="{
            backgroundColor: cal.selected ? (cal.color ?? '#6b7280') : 'transparent',
            borderColor: cal.color ?? '#6b7280',
          }"
          aria-hidden="true"
        />
        <span class="truncate" :class="{ 'bd-faint line-through': !cal.selected }">
          {{ cal.summary }}
        </span>
      </button>
    </div>
  </div>
</template>
