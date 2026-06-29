<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useChat } from "@ai-sdk/vue";
import {
  DefaultChatTransport,
  isDynamicToolUIPart,
  isStaticToolUIPart,
  type UIMessage,
} from "ai";

// ── Tool output interfaces ────────────────────────────────────────────────────

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}
interface WebSearchOutput {
  configured: boolean;
  results: WebSearchResult[];
  note?: string;
}

interface SearchDocumentsOutput {
  chunks: { filename: string; content: string }[];
}

interface SearchMemoryOutput {
  memories: string[];
}

type GoogleSync = "synced" | "needs-reauth" | "not-synced" | "off";

interface CreateTodoOutput {
  created: "todo";
  id: string;
  title: string;
  googleSync?: GoogleSync;
}

interface CreateEventOutput {
  created: "event";
  id: string;
  title: string;
  error?: string;
  googleSync?: GoogleSync;
}

function googleSyncNote(sync: GoogleSync | undefined): string {
  if (sync === "synced") return " · ✓ Google";
  if (sync === "needs-reauth") return " · ⚠ sign in again to sync";
  return "";
}

interface CalendarEvent {
  title: string;
  startsAt: string;
  endsAt: string;
}

interface ReadCalendarOutput {
  events: CalendarEvent[];
  scheduledTodos: { title: string }[];
  unscheduledTodos: { title: string }[];
  error?: string;
}

interface DeleteEventOutput {
  deleted: boolean;
  title?: string;
  reason?: "not-found" | "ambiguous";
  query?: string;
  matches?: { title: string; startsAt: string }[];
}

// ── Typed tool part ───────────────────────────────────────────────────────────

type ToolName =
  | "web_search"
  | "search_documents"
  | "search_memory"
  | "create_todo"
  | "create_event"
  | "delete_event"
  | "read_calendar";

type ToolOutputMap = {
  web_search: WebSearchOutput;
  search_documents: SearchDocumentsOutput;
  search_memory: SearchMemoryOutput;
  create_todo: CreateTodoOutput;
  create_event: CreateEventOutput;
  delete_event: DeleteEventOutput;
  read_calendar: ReadCalendarOutput;
};

type ToolState = "input-streaming" | "input-available" | "output-available" | "error";

interface ToolPart {
  toolName: ToolName;
  toolCallId: string;
  state: ToolState;
  // output is narrowed safely via accessor functions after checking toolName
  output: unknown;
}

function isKnownTool(name: string): name is ToolName {
  return [
    "web_search",
    "search_documents",
    "search_memory",
    "create_todo",
    "create_event",
    "delete_event",
    "read_calendar",
  ].includes(name);
}

function extractToolParts(msg: UIMessage): ToolPart[] {
  const parts: ToolPart[] = [];
  for (const part of msg.parts) {
    if (isDynamicToolUIPart(part)) {
      const name = part.toolName;
      if (isKnownTool(name)) {
        parts.push({
          toolName: name,
          toolCallId: part.toolCallId,
          state: part.state as ToolState,
          output: part.output as ToolOutputMap[typeof name],
        });
      } else {
        parts.push({
          toolName: name as ToolName,
          toolCallId: part.toolCallId,
          state: part.state as ToolState,
          output: part.output as unknown,
        });
      }
    } else if (isStaticToolUIPart(part)) {
      const name = (part.type as string).replace(/^tool-/, "");
      if (isKnownTool(name)) {
        parts.push({
          toolName: name,
          toolCallId: part.toolCallId,
          state: part.state as ToolState,
          output: part.output as ToolOutputMap[typeof name],
        });
      } else {
        parts.push({
          toolName: name as ToolName,
          toolCallId: part.toolCallId,
          state: part.state as ToolState,
          output: part.output as unknown,
        });
      }
    }
  }
  return parts;
}

// Typed output accessors (safe casts after toolName check)
function asWebSearch(output: unknown): WebSearchOutput {
  return output as WebSearchOutput;
}
function asSearchDocuments(output: unknown): SearchDocumentsOutput {
  return output as SearchDocumentsOutput;
}
function asSearchMemory(output: unknown): SearchMemoryOutput {
  return output as SearchMemoryOutput;
}
function asCreateTodo(output: unknown): CreateTodoOutput {
  return output as CreateTodoOutput;
}
function asCreateEvent(output: unknown): CreateEventOutput {
  return output as CreateEventOutput;
}
function asReadCalendar(output: unknown): ReadCalendarOutput {
  return output as ReadCalendarOutput;
}
function asDeleteEvent(output: unknown): DeleteEventOutput {
  return output as DeleteEventOutput;
}

// ── Chat setup ────────────────────────────────────────────────────────────────

const currentSessionId = ref<string | null>(null);

const { messages, sendMessage, status, error } = useChat({
  transport: new DefaultChatTransport({
    api: "/api/chat",
    body: () => ({
      sessionId: currentSessionId.value ?? undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  }),
});

// ── Session management ────────────────────────────────────────────────────────

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const sessions = ref<SessionSummary[]>([]);

async function refreshSessions(): Promise<void> {
  const data = await $fetch<SessionSummary[]>("/api/chats");
  sessions.value = data;
}

onMounted(() => { void refreshSessions(); });

async function newChat(): Promise<void> {
  currentSessionId.value = null;
  messages.value = [];
}

async function loadSession(id: string): Promise<void> {
  currentSessionId.value = id;
  const stored = await $fetch<{ id: string; role: string; content: string; createdAt: string }[]>(
    `/api/chats/${id}`,
  );
  messages.value = stored.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: [{ type: "text" as const, text: m.content }],
    metadata: {},
  }));
}

async function deleteSession(id: string): Promise<void> {
  await $fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (currentSessionId.value === id) {
    currentSessionId.value = null;
    messages.value = [];
  }
  await refreshSessions();
}

const input = ref<string>("");
const scrollEl = ref<HTMLElement | null>(null);

const isStreaming = computed(
  () => status.value === "submitted" || status.value === "streaming",
);

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text || isStreaming.value) return;
  input.value = "";
  if (!currentSessionId.value) {
    const data = await $fetch<{ id: string }>("/api/chats", { method: "POST" });
    currentSessionId.value = data.id;
    await refreshSessions();
  }
  await sendMessage({ role: "user", parts: [{ type: "text", text }] });
  // Refresh sidebar title after assistant responds (brief delay for onFinish)
  setTimeout(() => { void refreshSessions(); }, 1500);
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void submit();
  }
}

watch(
  messages,
  async () => {
    await nextTick();
    scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight, behavior: "smooth" });
  },
  { deep: true },
);

function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Date formatting for calendar events
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
</script>

<template>
  <div class="min-h-dvh bd-bg bd-text flex">
    <!-- Sidebar -->
    <aside class="w-56 shrink-0 border-r bd-border bd-surface flex flex-col">
      <!-- New chat button -->
      <div class="p-3 border-b bd-border">
        <button
          class="w-full text-left text-sm px-3 py-2 rounded border bd-border
                 bd-hover focus-visible:outline-none focus-visible:ring-2
                 focus-visible:ring-neutral-500 motion-safe:transition-colors"
          @click="newChat"
        >
          + New chat
        </button>
      </div>

      <!-- Session list -->
      <nav class="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Chat history">
        <div v-if="sessions.length === 0" class="text-xs bd-faint px-3 py-2 select-none">
          No chats yet
        </div>
        <div
          v-for="s in sessions"
          :key="s.id"
          :class="[
            'group flex items-center gap-1 rounded px-2 py-1.5 text-xs cursor-pointer',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500',
            currentSessionId === s.id
              ? 'bg-neutral-700 text-white'
              : 'bd-muted bd-hover',
          ]"
          tabindex="0"
          role="button"
          :aria-current="currentSessionId === s.id ? 'true' : undefined"
          :aria-label="`Open chat: ${s.title}`"
          @click="loadSession(s.id)"
          @keydown.enter="loadSession(s.id)"
          @keydown.space.prevent="loadSession(s.id)"
        >
          <span class="flex-1 truncate">{{ s.title }}</span>
          <button
            class="shrink-0 opacity-0 group-hover:opacity-100 bd-faint
                   hover:text-[var(--bd-text)] focus-visible:opacity-100 focus-visible:outline-none
                   focus-visible:ring-1 focus-visible:ring-neutral-500 rounded"
            :class="{ 'bd-faint hover:text-white': currentSessionId === s.id }"
            :aria-label="`Delete chat: ${s.title}`"
            @click.stop="deleteSession(s.id)"
          >
            ×
          </button>
        </div>
      </nav>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0">
    <!-- Header -->
    <header
      class="flex items-center justify-between px-4 py-2 border-b bd-border bd-surface shrink-0"
    >
      <NuxtLink
        to="/"
        class="text-sm bd-faint hover:text-[var(--bd-text)] focus-visible:outline-none
               focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
               motion-safe:transition-colors"
        aria-label="Back to calendar"
      >
        ← Calendar
      </NuxtLink>
      <h1 class="text-sm font-medium bd-muted select-none">Chat</h1>
      <span class="w-16" aria-hidden="true" />
    </header>

    <!-- Message list -->
    <main
      ref="scrollEl"
      class="flex-1 overflow-y-auto px-4 py-6"
      aria-label="Chat messages"
      aria-live="polite"
      aria-atomic="false"
    >
      <!-- Empty state -->
      <div
        v-if="messages.length === 0"
        class="flex items-center justify-center h-full text-sm bd-faint select-none"
      >
        Ask anything about your schedule, todos, or notes.
      </div>

      <ul class="space-y-4 max-w-2xl mx-auto" role="list">
        <li
          v-for="msg in messages"
          :key="msg.id"
          :class="[
            'flex flex-col gap-1',
            msg.role === 'user' ? 'items-end' : 'items-start',
          ]"
        >
          <!-- Bubble -->
          <div
            :class="[
              'max-w-prose rounded px-3 py-2 text-sm leading-relaxed',
              msg.role === 'user'
                ? 'bg-neutral-700 text-white'
                : 'bd-surface border bd-border bd-text',
            ]"
          >
            <span class="sr-only">{{ msg.role === "user" ? "You" : "Assistant" }}: </span>

            <!-- User messages: plain text -->
            <span v-if="msg.role === 'user'" class="whitespace-pre-wrap">
              {{ messageText(msg) }}
            </span>

            <!-- Assistant messages: rich markdown -->
            <MarkdownText v-else :content="messageText(msg)" />
          </div>

          <!-- Rich tool results (assistant only) -->
          <template v-if="msg.role === 'assistant'">
            <div
              v-for="tp in extractToolParts(msg)"
              :key="`${tp.toolName}-${tp.toolCallId}`"
              class="w-full max-w-prose"
            >
              <!-- Running state -->
              <p
                v-if="tp.state !== 'output-available'"
                class="text-xs bd-faint tabular-nums select-none px-1"
              >
                · running {{ tp.toolName }}…
              </p>

              <!-- web_search output -->
              <template v-else-if="tp.toolName === 'web_search'">
                <div
                  v-if="!asWebSearch(tp.output).configured"
                  class="text-xs bd-faint px-1"
                >
                  {{ asWebSearch(tp.output).note ?? "Web search not configured." }}
                </div>
                <ul
                  v-else-if="asWebSearch(tp.output).results.length > 0"
                  class="space-y-1.5 mt-1"
                >
                  <li
                    v-for="(r, i) in asWebSearch(tp.output).results"
                    :key="i"
                    class="border bd-border rounded px-3 py-2 bd-surface"
                  >
                    <a
                      :href="r.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block group"
                    >
                      <div class="text-xs font-medium bd-text group-hover:underline leading-snug">
                        {{ r.title }}
                      </div>
                      <div class="text-xs bd-faint truncate mt-0.5">{{ r.url }}</div>
                      <div class="text-xs bd-muted mt-1 leading-relaxed">{{ r.snippet }}</div>
                    </a>
                  </li>
                </ul>
                <p v-else class="text-xs bd-faint px-1">No web results found.</p>
              </template>

              <!-- search_documents output -->
              <template v-else-if="tp.toolName === 'search_documents'">
                <ul
                  v-if="asSearchDocuments(tp.output).chunks.length > 0"
                  class="space-y-1.5 mt-1"
                >
                  <li
                    v-for="(c, i) in asSearchDocuments(tp.output).chunks"
                    :key="i"
                    class="border bd-border rounded px-3 py-2 bd-surface"
                  >
                    <div class="text-xs bd-faint mb-0.5">{{ c.filename }}</div>
                    <div class="text-xs bd-muted leading-relaxed line-clamp-3">{{ c.content }}</div>
                  </li>
                </ul>
                <p v-else class="text-xs bd-faint px-1">· no document chunks found</p>
              </template>

              <!-- search_memory output -->
              <template v-else-if="tp.toolName === 'search_memory'">
                <ul
                  v-if="asSearchMemory(tp.output).memories.length > 0"
                  class="mt-1 pl-4 space-y-0.5 list-disc"
                >
                  <li
                    v-for="(m, i) in asSearchMemory(tp.output).memories"
                    :key="i"
                    class="text-xs bd-muted"
                  >
                    {{ m }}
                  </li>
                </ul>
                <p v-else class="text-xs bd-faint px-1">· no memories found</p>
              </template>

              <!-- create_todo output -->
              <template v-else-if="tp.toolName === 'create_todo'">
                <p class="text-xs bd-faint px-1 tabular-nums">
                  ✓ created todo: {{ asCreateTodo(tp.output).title }}{{ googleSyncNote(asCreateTodo(tp.output).googleSync) }}
                </p>
              </template>

              <!-- create_event output -->
              <template v-else-if="tp.toolName === 'create_event'">
                <p
                  v-if="asCreateEvent(tp.output).error"
                  class="text-xs bd-faint px-1"
                >
                  · event not created: {{ asCreateEvent(tp.output).error }}
                </p>
                <p v-else class="text-xs bd-faint px-1 tabular-nums">
                  ✓ created event: {{ asCreateEvent(tp.output).title }}{{ googleSyncNote(asCreateEvent(tp.output).googleSync) }}
                </p>
              </template>

              <!-- delete_event output -->
              <template v-else-if="tp.toolName === 'delete_event'">
                <p v-if="asDeleteEvent(tp.output).deleted" class="text-xs bd-faint px-1 tabular-nums">
                  ✓ removed: {{ asDeleteEvent(tp.output).title }}
                </p>
                <p v-else-if="asDeleteEvent(tp.output).reason === 'not-found'" class="text-xs bd-faint px-1">
                  · no event matching “{{ asDeleteEvent(tp.output).query }}”
                </p>
                <p v-else class="text-xs bd-faint px-1">
                  · multiple matches — which one? {{ (asDeleteEvent(tp.output).matches ?? []).map((m) => m.title).join(", ") }}
                </p>
              </template>

              <!-- read_calendar output -->
              <template v-else-if="tp.toolName === 'read_calendar'">
                <div class="border bd-border rounded px-3 py-2 bd-surface mt-1">
                  <div class="text-xs bd-faint mb-1 tabular-nums">
                    {{ asReadCalendar(tp.output).events.length }} event{{
                      asReadCalendar(tp.output).events.length === 1 ? "" : "s"
                    }},
                    {{ asReadCalendar(tp.output).scheduledTodos.length }} scheduled todo{{
                      asReadCalendar(tp.output).scheduledTodos.length === 1 ? "" : "s"
                    }},
                    {{ asReadCalendar(tp.output).unscheduledTodos.length }} unscheduled
                  </div>
                  <ul v-if="asReadCalendar(tp.output).events.length > 0" class="space-y-0.5">
                    <li
                      v-for="(ev, i) in asReadCalendar(tp.output).events"
                      :key="i"
                      class="text-xs bd-muted tabular-nums flex gap-2"
                    >
                      <span class="bd-faint shrink-0">
                        {{ formatTime(ev.startsAt) }}
                      </span>
                      <span>{{ ev.title }}</span>
                    </li>
                  </ul>
                  <ul
                    v-if="asReadCalendar(tp.output).scheduledTodos.length > 0"
                    class="mt-1 space-y-0.5"
                  >
                    <li
                      v-for="(t, i) in asReadCalendar(tp.output).scheduledTodos"
                      :key="i"
                      class="text-xs bd-faint"
                    >
                      ☐ {{ t.title }}
                    </li>
                  </ul>
                  <ul
                    v-if="asReadCalendar(tp.output).unscheduledTodos.length > 0"
                    class="mt-1 space-y-0.5"
                  >
                    <li
                      v-for="(t, i) in asReadCalendar(tp.output).unscheduledTodos"
                      :key="i"
                      class="text-xs bd-faint"
                    >
                      ☐ {{ t.title }} <span class="italic">(unscheduled)</span>
                    </li>
                  </ul>
                </div>
              </template>
            </div>
          </template>
        </li>

        <!-- Streaming indicator -->
        <li v-if="isStreaming" class="flex items-start" aria-label="Assistant is typing">
          <div
            class="bd-surface border bd-border rounded px-3 py-2 text-sm bd-faint
                   motion-safe:animate-pulse select-none"
            aria-busy="true"
          >
            …
          </div>
        </li>
      </ul>

      <!-- Error state -->
      <p
        v-if="error"
        role="alert"
        class="mt-4 text-sm text-center bd-faint"
      >
        Something went wrong. Please try again.
      </p>
    </main>

    <!-- Input area -->
    <footer class="border-t bd-border bd-surface px-4 py-3 shrink-0">
      <form
        class="flex gap-2 max-w-2xl mx-auto"
        aria-label="Send a message"
        @submit.prevent="submit"
      >
        <label for="chat-input" class="sr-only">Message</label>
        <textarea
          id="chat-input"
          v-model="input"
          name="message"
          rows="2"
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          class="flex-1 resize-none rounded border bd-border bd-bg px-3 py-2
                 text-sm leading-relaxed bd-text placeholder:bd-faint
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500
                 motion-safe:transition-colors disabled:opacity-50"
          :disabled="isStreaming"
          @keydown="handleKeydown"
        />
        <button
          type="submit"
          class="self-end px-4 py-2 rounded border border-neutral-700 bg-neutral-700 text-white
                 text-sm font-medium hover:bg-neutral-600 focus-visible:outline-none
                 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2
                 motion-safe:transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isStreaming || !input.trim()"
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    </footer>
    </div><!-- end main content -->
  </div>
</template>
