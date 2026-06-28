<script setup lang="ts">
import { ref } from "vue";

useHead({ title: "Documents — Braindump" });

// ── Types ─────────────────────────────────────────────────────────────────

interface Document {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

interface DocumentSearchResult {
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
}

interface UploadResult {
  documentId: string;
  filename: string;
  chunks: number;
}

// ── Data ──────────────────────────────────────────────────────────────────

const { data: documents, refresh } = await useFetch<Document[]>("/api/documents");

// ── Toast ─────────────────────────────────────────────────────────────────

const toast = useToast();

// ── Upload ────────────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref<boolean>(false);
const uploadError = ref<string>("");

async function handleUpload(): Promise<void> {
  const file = fileInput.value?.files?.[0];
  if (!file) return;

  uploading.value = true;
  uploadError.value = "";

  const form = new FormData();
  form.append("file", file);

  try {
    const result = await $fetch<UploadResult>("/api/documents", {
      method: "POST",
      body: form,
    });
    if (fileInput.value) fileInput.value.value = "";
    await refresh();
    toast.add({
      title: `Uploaded "${result.filename}" (${result.chunks} chunk${result.chunks === 1 ? "" : "s"})`,
      color: "neutral",
    });
  } catch (err: unknown) {
    const fe = err as { statusCode?: number; statusMessage?: string; data?: { statusMessage?: string } };
    if (fe.statusCode === 400) {
      uploadError.value =
        fe.data?.statusMessage ?? fe.statusMessage ?? "File not supported or too large.";
    } else {
      uploadError.value = "Upload failed. Please try again.";
    }
  } finally {
    uploading.value = false;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────

const deletingId = ref<string | null>(null);
const deleteError = ref<string>("");

async function deleteDocument(id: string): Promise<void> {
  if (!confirm("Delete this document? This cannot be undone.")) return;
  deletingId.value = id;
  deleteError.value = "";
  try {
    await $fetch(`/api/documents/${id}`, { method: "DELETE" });
    await refresh();
  } catch {
    deleteError.value = "Failed to delete document.";
  } finally {
    deletingId.value = null;
  }
}

// ── Search ────────────────────────────────────────────────────────────────

const searchQuery = ref<string>("");
const searchResults = ref<DocumentSearchResult[] | null>(null);
const searching = ref<boolean>(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = searchQuery.value.trim();
    if (!q) {
      searchResults.value = null;
      return;
    }
    searching.value = true;
    try {
      searchResults.value = await $fetch<DocumentSearchResult[]>(
        `/api/documents/search?q=${encodeURIComponent(q)}`,
      );
    } catch {
      searchResults.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function excerpt(content: string, maxLen = 200): string {
  return content.length > maxLen ? `${content.slice(0, maxLen)}…` : content;
}
</script>

<template>
  <div class="min-h-dvh bg-neutral-50 text-neutral-900 flex flex-col">
    <!-- Header -->
    <header
      class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 bg-white shrink-0"
    >
      <NuxtLink
        to="/"
        class="text-sm text-neutral-500 hover:text-neutral-900 rounded
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
               motion-safe:transition-colors"
        aria-label="Back to calendar"
      >
        ← Calendar
      </NuxtLink>
      <h1 class="text-sm font-medium text-neutral-700">Documents</h1>
      <div class="w-20" aria-hidden="true" />
    </header>

    <!-- Body -->
    <main class="flex-1 flex flex-col items-center px-4 py-10 gap-10 max-w-2xl mx-auto w-full">

      <!-- Upload -->
      <section class="w-full flex flex-col gap-3" aria-labelledby="upload-heading">
        <h2
          id="upload-heading"
          class="text-xs font-semibold tracking-widest uppercase text-neutral-400"
        >
          Upload document
        </h2>
        <div class="flex items-center gap-3">
          <label class="sr-only" for="doc-file-input">Choose file</label>
          <input
            id="doc-file-input"
            ref="fileInput"
            type="file"
            accept=".txt,.md,.pdf"
            :disabled="uploading"
            class="flex-1 text-sm text-neutral-700 file:mr-3 file:py-1.5 file:px-3
                   file:rounded file:border file:border-neutral-200 file:bg-white
                   file:text-xs file:font-medium file:text-neutral-700
                   file:cursor-pointer hover:file:bg-neutral-50
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                   disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            :disabled="uploading"
            class="px-4 py-2 rounded text-sm font-medium bg-neutral-900 text-white
                   hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2
                   motion-safe:transition-colors"
            @click="handleUpload"
          >
            <span v-if="uploading">Uploading…</span>
            <span v-else>Upload</span>
          </button>
        </div>
        <p v-if="uploadError" class="text-xs text-neutral-500">{{ uploadError }}</p>
      </section>

      <!-- Search -->
      <section class="w-full flex flex-col gap-3" aria-labelledby="search-heading">
        <h2
          id="search-heading"
          class="text-xs font-semibold tracking-widest uppercase text-neutral-400"
        >
          Search
        </h2>
        <label class="sr-only" for="doc-search">Search documents</label>
        <input
          id="doc-search"
          v-model="searchQuery"
          type="search"
          placeholder="Search document content…"
          class="w-full rounded border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900
                 placeholder-neutral-400
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          @input="onSearchInput"
        />

        <!-- Search results -->
        <div v-if="searchQuery.trim()">
          <p v-if="searching" class="text-sm text-neutral-400">Searching…</p>

          <div
            v-else-if="searchResults !== null"
          >
            <div
              v-if="searchResults.length === 0"
              class="py-8 text-center text-sm text-neutral-400"
            >
              No matching content found.
            </div>

            <template v-else>
              <p class="text-[11px] text-neutral-400 mb-2 tabular-nums">
                {{ searchResults.length }} result{{ searchResults.length === 1 ? "" : "s" }}
              </p>

              <ul
                class="divide-y divide-neutral-200 border border-neutral-200 rounded bg-white"
              >
              <li
                v-for="(r, i) in searchResults"
                :key="`${r.documentId}-${r.chunkIndex}-${i}`"
                class="px-4 py-3 flex flex-col gap-1"
              >
                <span class="text-[11px] font-medium text-neutral-500 tabular-nums">
                  {{ r.filename }} · chunk {{ r.chunkIndex + 1 }}
                </span>
                <p class="text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">
                  {{ excerpt(r.content) }}
                </p>
              </li>
              </ul>
            </template>
          </div>
        </div>
      </section>

      <!-- Document list -->
      <section class="w-full flex flex-col gap-3" aria-labelledby="docs-heading">
        <h2
          id="docs-heading"
          class="text-xs font-semibold tracking-widest uppercase text-neutral-400"
        >
          Documents
        </h2>

        <p v-if="deleteError" class="text-xs text-neutral-500">{{ deleteError }}</p>

        <!-- Empty state -->
        <div
          v-if="!documents || documents.length === 0"
          class="py-16 text-center text-sm text-neutral-400"
        >
          No documents yet.
        </div>

        <ul
          v-else
          class="divide-y divide-neutral-200 border border-neutral-200 rounded bg-white"
        >
          <li
            v-for="doc in documents"
            :key="doc.id"
            class="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-sm text-neutral-800 truncate">{{ doc.filename }}</span>
              <span class="text-[11px] text-neutral-400 tabular-nums">
                {{ humanSize(doc.sizeBytes) }}
              </span>
            </div>
            <button
              type="button"
              :disabled="deletingId === doc.id"
              class="shrink-0 text-xs text-neutral-500 hover:text-neutral-900
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
                     disabled:opacity-40 motion-safe:transition-colors"
              :aria-label="`Delete ${doc.filename}`"
              @click="deleteDocument(doc.id)"
            >
              <span v-if="deletingId === doc.id">Deleting…</span>
              <span v-else>Delete</span>
            </button>
          </li>
        </ul>
      </section>

    </main>
  </div>
</template>
