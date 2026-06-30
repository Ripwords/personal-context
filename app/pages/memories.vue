<script setup lang="ts">
import { ref, computed } from "vue";

useHead({ title: "Memory — Braindump" });

interface Memory {
  id: string;
  content: string;
  source: string;
  createdAt: string;
}

// ── Data ──────────────────────────────────────────────────────────────────

const { data: memories, refresh } = await useFetch<Memory[]>("/api/memory");

// ── Search ────────────────────────────────────────────────────────────────

const searchQuery = ref<string>("");
const searchResults = ref<Memory[] | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = searchQuery.value.trim();
    if (!q) {
      searchResults.value = null;
      return;
    }
    searchResults.value = await $fetch<Memory[]>(`/api/memory?q=${encodeURIComponent(q)}`);
  }, 300);
}

const displayed = computed<Memory[]>(() =>
  searchResults.value !== null ? searchResults.value : (memories.value ?? [])
);

// ── Add memory ────────────────────────────────────────────────────────────

const newContent = ref<string>("");
const adding = ref<boolean>(false);
const addError = ref<string>("");

async function addMemory(): Promise<void> {
  const content = newContent.value.trim();
  if (!content) return;
  adding.value = true;
  addError.value = "";
  try {
    await $fetch("/api/memory", { method: "POST", body: { content } });
    newContent.value = "";
    await refresh();
  } catch {
    addError.value = "Failed to save memory.";
  } finally {
    adding.value = false;
  }
}

// ── Inline edit ───────────────────────────────────────────────────────────

const editingId = ref<string | null>(null);
const editContent = ref<string>("");
const saving = ref<boolean>(false);
const editError = ref<string>("");

function startEdit(m: Memory): void {
  editingId.value = m.id;
  editContent.value = m.content;
}

function cancelEdit(): void {
  editingId.value = null;
  editContent.value = "";
}

async function saveEdit(id: string): Promise<void> {
  const content = editContent.value.trim();
  if (!content) return;
  saving.value = true;
  editError.value = "";
  try {
    await $fetch(`/api/memory/${id}`, { method: "PATCH", body: { content } });
    editingId.value = null;
    editContent.value = "";
    await refresh();
    if (searchResults.value !== null) {
      const q = searchQuery.value.trim();
      if (q) searchResults.value = await $fetch<Memory[]>(`/api/memory?q=${encodeURIComponent(q)}`);
    }
  } catch {
    editError.value = "Failed to save changes.";
  } finally {
    saving.value = false;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────

const deletingId = ref<string | null>(null);
const deleteError = ref<string>("");

async function deleteMemory(id: string): Promise<void> {
  if (!confirm("Delete this memory?")) return;
  deletingId.value = id;
  deleteError.value = "";
  try {
    await $fetch(`/api/memory/${id}`, { method: "DELETE" });
    await refresh();
    if (searchResults.value !== null) {
      searchResults.value = searchResults.value.filter((m) => m.id !== id);
    }
  } catch {
    deleteError.value = "Failed to delete memory.";
  } finally {
    deletingId.value = null;
  }
}

// ── Relative time ─────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
</script>

<template>
  <div class="min-h-dvh bd-bg bd-text flex flex-col">
    <!-- Header -->
    <AppHeader title="Memory" />

    <!-- Body -->
    <main class="flex-1 flex flex-col items-center px-4 py-10 gap-8 max-w-2xl mx-auto w-full">

      <!-- Search -->
      <div class="w-full">
        <label for="memory-search" class="text-xs font-semibold tracking-widest uppercase bd-faint block mb-2">
          Search
        </label>
        <input
          id="memory-search"
          v-model="searchQuery"
          type="search"
          placeholder="Search memories…"
          class="w-full rounded border bd-border bd-bg px-3 py-2 text-sm bd-text
                 placeholder:text-[var(--bd-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
          @input="onSearchInput"
        />
      </div>

      <!-- Add memory -->
      <div class="w-full flex flex-col gap-2">
        <label for="memory-add" class="text-xs font-semibold tracking-widest uppercase bd-faint">
          Add memory
        </label>
        <UTextarea
          id="memory-add"
          v-model="newContent"
          :rows="3"
          placeholder="Something worth remembering…"
          :disabled="adding"
          :ui="{
            base: 'w-full resize-none rounded border border-[var(--bd-border)] bg-[var(--bd-bg)] px-3 py-2 text-sm text-[var(--bd-text)] placeholder:text-[var(--bd-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-50',
          }"
          @keydown.meta.enter="addMemory"
          @keydown.ctrl.enter="addMemory"
        />
        <p v-if="addError" class="text-xs bd-faint">{{ addError }}</p>
        <div class="flex justify-end">
          <button
            type="button"
            :disabled="adding || !newContent.trim()"
            class="px-4 py-2 rounded text-sm font-medium bg-[var(--bd-surface-2)] bd-text
                   hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2
                   motion-safe:transition-colors"
            @click="addMemory"
          >
            <span v-if="adding">Saving…</span>
            <span v-else>Save</span>
          </button>
        </div>
      </div>

      <!-- Memory list -->
      <section class="w-full" aria-label="Memories">
        <p class="text-xs font-semibold tracking-widest uppercase bd-faint mb-3">
          {{ displayed.length }} {{ displayed.length === 1 ? "memory" : "memories" }}
          <span v-if="searchQuery.trim()">&nbsp;matching "{{ searchQuery.trim() }}"</span>
        </p>

        <p v-if="deleteError" class="text-xs text-red-600 mb-2">{{ deleteError }}</p>

        <!-- Empty state -->
        <div v-if="displayed.length === 0" class="py-16 text-center text-sm bd-faint">
          <span v-if="searchQuery.trim()">No memories match your search.</span>
          <span v-else>No memories yet. Add one above.</span>
        </div>

        <!-- List -->
        <ul v-else class="divide-y divide-neutral-800 border bd-border rounded bd-surface">
          <li
            v-for="m in displayed"
            :key="m.id"
            class="flex flex-col gap-2 px-4 py-3"
          >
            <!-- View mode -->
            <template v-if="editingId !== m.id">
              <p class="text-sm bd-text whitespace-pre-wrap leading-relaxed">{{ m.content }}</p>
              <div class="flex items-center justify-between gap-4">
                <span class="text-[11px] bd-faint">
                  {{ m.source }} · {{ relativeTime(m.createdAt) }}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="text-xs bd-faint hover:text-[var(--bd-text)] focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
                           motion-safe:transition-colors"
                    @click="startEdit(m)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    :disabled="deletingId === m.id"
                    class="text-xs bd-faint hover:text-[var(--bd-text)] focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
                           disabled:opacity-40 motion-safe:transition-colors"
                    @click="deleteMemory(m.id)"
                  >
                    <span v-if="deletingId === m.id">Deleting…</span>
                    <span v-else>Delete</span>
                  </button>
                </div>
              </div>
            </template>

            <!-- Edit mode -->
            <template v-else>
              <UTextarea
                v-model="editContent"
                :rows="3"
                :disabled="saving"
                :ui="{
                  base: 'w-full resize-none rounded border border-[var(--bd-border)] bg-[var(--bd-bg)] px-3 py-2 text-sm text-[var(--bd-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-50',
                }"
                @keydown.meta.enter="saveEdit(m.id)"
                @keydown.ctrl.enter="saveEdit(m.id)"
                @keydown.escape="cancelEdit"
              />
              <p v-if="editError" class="text-xs text-red-600">{{ editError }}</p>
              <div class="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  class="text-xs bd-faint hover:text-[var(--bd-text)] focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
                         motion-safe:transition-colors"
                  @click="cancelEdit"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  :disabled="saving || !editContent.trim()"
                  class="px-3 py-1 rounded text-xs font-medium bg-[var(--bd-surface-2)] bd-text
                         hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500
                         motion-safe:transition-colors"
                  @click="saveEdit(m.id)"
                >
                  <span v-if="saving">Saving…</span>
                  <span v-else>Save</span>
                </button>
              </div>
            </template>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
