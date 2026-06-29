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
  memoriesSaved: number;
  writtenToGoogle?: number;
  needsReauth?: boolean;
}

const toast = useToast();

const text = ref<string>("");
const loading = ref<boolean>(false);
const lastCreated = ref<CreatedItem[]>([]);
const activityFeed = ref<InstanceType<typeof ActivityFeed> | null>(null);
const memoryCue = ref<string>("");
let memoryCueTimer: ReturnType<typeof setTimeout> | null = null;

async function capture(): Promise<void> {
  if (!text.value.trim()) return;

  loading.value = true;
  lastCreated.value = [];

  try {
    const result = await $fetch<DumpResult>("/api/dump", {
      method: "POST",
      body: { text: text.value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });

    lastCreated.value = result.created;
    text.value = "";
    if (result.needsReauth) {
      toast.add({
        title: "Saved locally — not synced to Google",
        description: "Sign in again to grant calendar access.",
        color: "warning",
      });
    } else if (result.writtenToGoogle) {
      toast.add({ title: `Captured · synced ${result.writtenToGoogle} to Google`, color: "success" });
    } else {
      toast.add({ title: "Captured", color: "neutral" });
    }
    await activityFeed.value?.refresh();
    if (result.memoriesSaved > 0) {
      if (memoryCueTimer) clearTimeout(memoryCueTimer);
      memoryCue.value = `🧠 ${result.memoriesSaved} saved to memory`;
      memoryCueTimer = setTimeout(() => { memoryCue.value = ""; }, 3500);
    }
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
  <div class="min-h-dvh bd-bg bd-text flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-2 border-b bd-border bd-surface shrink-0">
      <NuxtLink
        to="/"
        class="text-sm bd-faint hover:text-[var(--bd-text)]
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
               motion-safe:transition-colors"
        aria-label="Back to calendar"
      >
        ← Calendar
      </NuxtLink>
      <h1 class="text-sm font-medium bd-muted">Braindump</h1>
      <div class="w-20" aria-hidden="true" />
    </header>

    <!-- Body -->
    <main class="flex-1 flex flex-col items-center px-4 py-10 gap-8 max-w-2xl mx-auto w-full">
      <div class="w-full flex flex-col gap-3">
        <label for="dump-textarea" class="text-xs font-semibold tracking-widest uppercase bd-faint">
          What's on your mind?
        </label>
        <UTextarea
          id="dump-textarea"
          v-model="text"
          :rows="10"
          placeholder="Dump everything here — todos, events, ideas…"
          :disabled="loading"
          :ui="{
            base: 'w-full resize-none rounded border bd-border bd-bg px-4 py-3 text-sm bd-text placeholder:bd-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed',
          }"
          @keydown.meta.enter="capture"
          @keydown.ctrl.enter="capture"
        />
        <div class="flex items-center justify-end gap-3">
          <Transition
            enter-active-class="motion-safe:transition-opacity motion-safe:duration-300"
            leave-active-class="motion-safe:transition-opacity motion-safe:duration-700"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <p
              v-if="memoryCue"
              aria-live="polite"
              class="text-xs bd-faint"
            >
              {{ memoryCue }}
            </p>
          </Transition>
          <button
            type="button"
            :disabled="loading || !text.trim()"
            class="px-4 py-2 rounded text-sm font-medium bg-neutral-700 text-white
                   hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bd-bg)]
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
        <p class="text-xs font-semibold tracking-widest uppercase bd-faint">
          Extracted {{ lastCreated.length }} item{{ lastCreated.length === 1 ? "" : "s" }}
        </p>
        <ul class="flex flex-col gap-1">
          <li
            v-for="item in lastCreated"
            :key="item.id"
            class="flex items-center gap-2 px-3 py-2 border bd-border rounded bd-surface"
          >
            <!-- Kind badge -->
            <span
              class="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider
                     border bd-border rounded bd-faint bd-surface-2"
            >
              {{ item.kind }}
            </span>

            <!-- Title -->
            <span class="flex-1 text-sm bd-text truncate">{{ item.title }}</span>

            <!-- Low-confidence tag -->
            <span
              v-if="item.lowConfidence"
              class="shrink-0 text-[10px] font-medium bd-faint italic"
              title="AI was less certain about this item"
            >
              needs review
            </span>
          </li>
        </ul>
      </section>

      <!-- Recent activity -->
      <div class="w-full border bd-border rounded bd-surface px-6 py-5">
        <ActivityFeed ref="activityFeed" />
      </div>
    </main>
  </div>
</template>
