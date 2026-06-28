<script setup lang="ts">
import { ref } from "vue";

interface WindDownItem {
  todoId: string;
  title: string;
}

interface WindDownGroup {
  project: string | null;
  items: WindDownItem[];
}

interface WindDownSlot {
  todoId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

interface WindDownProposal {
  groups: WindDownGroup[];
  schedule: WindDownSlot[];
}

const toast = useToast();

const loading = ref<boolean>(false);
const proposal = ref<WindDownProposal | null>(null);
const applying = ref<boolean>(false);

async function summarize(): Promise<void> {
  loading.value = true;
  proposal.value = null;
  try {
    proposal.value = await $fetch<WindDownProposal>("/api/wind-down", { method: "POST" });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 502) {
      toast.add({ title: "Wind-down failed — model error. Try again.", color: "neutral" });
    } else {
      toast.add({ title: "Something went wrong.", color: "neutral" });
    }
  } finally {
    loading.value = false;
  }
}

async function applySchedule(): Promise<void> {
  if (!proposal.value) return;
  applying.value = true;
  try {
    const blocks = proposal.value.schedule.map((s: WindDownSlot) => ({
      todoId: s.todoId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    }));
    const result = await $fetch<{ scheduled: number }>("/api/wind-down/apply", {
      method: "POST",
      body: { blocks },
    });
    toast.add({ title: `Scheduled ${result.scheduled} items`, color: "neutral" });
  } catch {
    toast.add({ title: "Failed to apply schedule.", color: "neutral" });
  } finally {
    applying.value = false;
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
</script>

<template>
  <div class="min-h-dvh bg-neutral-50 text-neutral-900 flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 bg-white shrink-0">
      <NuxtLink
        to="/"
        class="text-sm text-neutral-500 hover:text-neutral-900
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
               motion-safe:transition-colors"
        aria-label="Back to calendar"
      >
        ← Calendar
      </NuxtLink>
      <h1 class="text-sm font-medium text-neutral-700">Wind down</h1>
      <NuxtLink
        to="/dump"
        class="text-sm text-neutral-500 hover:text-neutral-900
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
               motion-safe:transition-colors"
      >
        Dump
      </NuxtLink>
    </header>

    <!-- Body -->
    <main class="flex-1 flex flex-col items-center px-4 py-10 gap-8 max-w-2xl mx-auto w-full">
      <!-- Summarize button -->
      <div class="w-full">
        <button
          type="button"
          :disabled="loading"
          class="px-4 py-2 rounded text-sm font-medium bg-neutral-900 text-white
                 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2
                 motion-safe:transition-colors"
          @click="summarize"
        >
          <span v-if="loading" aria-live="polite">Summarizing…</span>
          <span v-else>Summarize my day</span>
        </button>
      </div>

      <!-- Proposal -->
      <template v-if="proposal">
        <!-- Groups -->
        <section class="w-full flex flex-col gap-4">
          <h2 class="text-xs font-semibold tracking-widest uppercase text-neutral-400">
            Today's todos by project
          </h2>
          <div
            v-for="group in proposal.groups"
            :key="group.project ?? '__none__'"
            class="border border-neutral-200 rounded bg-white"
          >
            <div class="px-4 py-2 border-b border-neutral-100">
              <span class="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
                {{ group.project ?? "No project" }}
              </span>
            </div>
            <ul class="divide-y divide-neutral-100">
              <li
                v-for="item in group.items"
                :key="item.todoId"
                class="px-4 py-2 text-sm text-neutral-800"
              >
                {{ item.title }}
              </li>
            </ul>
          </div>
        </section>

        <!-- Schedule -->
        <section class="w-full flex flex-col gap-4">
          <h2 class="text-xs font-semibold tracking-widest uppercase text-neutral-400">
            Proposed schedule for tomorrow
          </h2>
          <div class="border border-neutral-200 rounded bg-white divide-y divide-neutral-100">
            <div
              v-for="slot in proposal.schedule"
              :key="slot.todoId"
              class="flex items-center gap-4 px-4 py-3"
            >
              <span class="shrink-0 text-sm tabular-nums font-mono text-neutral-500">
                {{ fmtTime(slot.startsAt) }} – {{ fmtTime(slot.endsAt) }}
              </span>
              <span class="flex-1 text-sm text-neutral-800">{{ slot.title }}</span>
            </div>
          </div>
        </section>

        <!-- Apply -->
        <div class="w-full flex justify-end">
          <button
            type="button"
            :disabled="applying"
            class="px-4 py-2 rounded text-sm font-medium border border-neutral-900 text-neutral-900 bg-white
                   hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2
                   motion-safe:transition-colors"
            @click="applySchedule"
          >
            <span v-if="applying" aria-live="polite">Applying…</span>
            <span v-else>Apply schedule</span>
          </button>
        </div>
      </template>
    </main>
  </div>
</template>
