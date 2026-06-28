<script setup lang="ts">
import { ref } from "vue";
import type ActivityFeed from "~/components/ActivityFeed.vue";

interface CreatedItem {
  kind: "todo" | "event";
  id: string;
  title: string;
  projectId: string | null;
  confidence: number | null;
  lowConfidence: boolean;
}

interface DumpResult {
  dumpId: string;
  created: CreatedItem[];
}

const toast = useToast();

const text = ref<string>("");
const loading = ref<boolean>(false);
const lastCreated = ref<CreatedItem[]>([]);
const activityFeed = ref<InstanceType<typeof ActivityFeed> | null>(null);

async function capture(): Promise<void> {
  if (!text.value.trim()) return;

  loading.value = true;
  lastCreated.value = [];

  try {
    const result = await $fetch<DumpResult>("/api/dump", {
      method: "POST",
      body: { text: text.value },
    });

    lastCreated.value = result.created;
    text.value = "";
    toast.add({ title: "Captured", color: "neutral" });
    await activityFeed.value?.refresh();
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 502) {
      toast.add({ title: "Extraction failed — your dump was saved.", color: "neutral" });
    } else {
      toast.add({ title: "Something went wrong.", color: "neutral" });
    }
  } finally {
    loading.value = false;
  }
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
      <h1 class="text-sm font-medium text-neutral-700">Braindump</h1>
      <div class="w-20" aria-hidden="true" />
    </header>

    <!-- Body -->
    <main class="flex-1 flex flex-col items-center px-4 py-10 gap-8 max-w-2xl mx-auto w-full">
      <div class="w-full flex flex-col gap-3">
        <label for="dump-textarea" class="text-xs font-semibold tracking-widest uppercase text-neutral-400">
          What's on your mind?
        </label>
        <UTextarea
          id="dump-textarea"
          v-model="text"
          :rows="10"
          placeholder="Dump everything here — todos, events, ideas…"
          :disabled="loading"
          :ui="{
            base: 'w-full resize-none rounded border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed',
          }"
          @keydown.meta.enter="capture"
          @keydown.ctrl.enter="capture"
        />
        <div class="flex justify-end">
          <button
            type="button"
            :disabled="loading || !text.trim()"
            class="px-4 py-2 rounded text-sm font-medium bg-neutral-900 text-white
                   hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2
                   motion-safe:transition-colors"
            @click="capture"
          >
            <span v-if="loading" aria-live="polite">Extracting…</span>
            <span v-else>Capture</span>
          </button>
        </div>
      </div>

      <!-- Extracted items -->
      <section
        v-if="lastCreated.length > 0"
        aria-label="Extracted items"
        class="w-full flex flex-col gap-2"
      >
        <p class="text-xs font-semibold tracking-widest uppercase text-neutral-400">
          Extracted {{ lastCreated.length }} item{{ lastCreated.length === 1 ? "" : "s" }}
        </p>
        <ul class="flex flex-col gap-1">
          <li
            v-for="item in lastCreated"
            :key="item.id"
            class="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded bg-white"
          >
            <!-- Kind badge -->
            <span
              class="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider
                     border border-neutral-200 rounded text-neutral-500 bg-neutral-50"
            >
              {{ item.kind }}
            </span>

            <!-- Title -->
            <span class="flex-1 text-sm text-neutral-800 truncate">{{ item.title }}</span>

            <!-- Low-confidence tag -->
            <span
              v-if="item.lowConfidence"
              class="shrink-0 text-[10px] font-medium text-neutral-400 italic"
              title="AI was less certain about this item"
            >
              needs review
            </span>
          </li>
        </ul>
      </section>

      <!-- Recent activity -->
      <div class="w-full border border-neutral-200 rounded bg-white px-6 py-5">
        <ActivityFeed ref="activityFeed" />
      </div>
    </main>
  </div>
</template>
