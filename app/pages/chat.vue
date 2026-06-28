<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useChat } from "@ai-sdk/vue";
import { DefaultChatTransport, isDynamicToolUIPart, isStaticToolUIPart, type UIMessage } from "ai";

const { messages, sendMessage, status, error } = useChat({
  transport: new DefaultChatTransport({ api: "/api/chat" }),
});

const input = ref<string>("");
const scrollEl = ref<HTMLElement | null>(null);

// ChatStatus: 'submitted' | 'streaming' | 'ready' | 'error'
const isStreaming = computed(
  () => status.value === "submitted" || status.value === "streaming",
);

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text || isStreaming.value) return;
  input.value = "";
  await sendMessage({ role: "user", parts: [{ type: "text", text }] });
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void submit();
  }
}

// Auto-scroll to bottom when messages change
watch(
  messages,
  async () => {
    await nextTick();
    scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight, behavior: "smooth" });
  },
  { deep: true },
);

// Helper: extract text content from a UIMessage
function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// Helper: extract tool invocations from a UIMessage
interface ToolNote {
  key: string;
  label: string;
}

function toolNotes(msg: UIMessage): ToolNote[] {
  const notes: ToolNote[] = [];
  for (const part of msg.parts) {
    if (isDynamicToolUIPart(part)) {
      const toolName = part.toolName;
      if (part.state === "output-available") {
        const result = part.output as Record<string, unknown> | undefined;
        let label = `· used ${toolName}`;
        if (result && "created" in result) {
          label = `· created ${String(result.created)}: ${String(result.title ?? "")}`;
        } else if (result && "memories" in result) {
          const arr = result.memories as unknown[];
          label = `· recalled ${arr.length} memor${arr.length === 1 ? "y" : "ies"}`;
        } else if (result && "chunks" in result) {
          const arr = result.chunks as unknown[];
          label = `· found ${arr.length} document chunk${arr.length === 1 ? "" : "s"}`;
        } else if (result && "events" in result) {
          const arr = result.events as unknown[];
          label = `· read calendar (${arr.length} event${arr.length === 1 ? "" : "s"})`;
        }
        notes.push({ key: `${toolName}-${part.toolCallId}`, label });
      } else if (part.state === "input-streaming" || part.state === "input-available") {
        notes.push({ key: `${toolName}-${part.toolCallId}`, label: `· calling ${toolName}…` });
      }
    } else if (isStaticToolUIPart(part)) {
      // type is 'tool-<name>'; extract name from type string
      const toolName = (part.type as string).replace(/^tool-/, "");
      if (part.state === "output-available") {
        const result = part.output as Record<string, unknown> | undefined;
        let label = `· used ${toolName}`;
        if (result && "created" in result) {
          label = `· created ${String(result.created)}: ${String(result.title ?? "")}`;
        } else if (result && "memories" in result) {
          const arr = result.memories as unknown[];
          label = `· recalled ${arr.length} memor${arr.length === 1 ? "y" : "ies"}`;
        } else if (result && "chunks" in result) {
          const arr = result.chunks as unknown[];
          label = `· found ${arr.length} document chunk${arr.length === 1 ? "" : "s"}`;
        } else if (result && "events" in result) {
          const arr = result.events as unknown[];
          label = `· read calendar (${arr.length} event${arr.length === 1 ? "" : "s"})`;
        }
        notes.push({ key: `${toolName}-${part.toolCallId}`, label });
      } else if (part.state === "input-streaming" || part.state === "input-available") {
        notes.push({ key: `${toolName}-${part.toolCallId}`, label: `· calling ${toolName}…` });
      }
    }
  }
  return notes;
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
        class="text-sm text-neutral-500 hover:text-neutral-900 focus-visible:outline-none
               focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
               motion-safe:transition-colors"
        aria-label="Back to calendar"
      >
        ← Calendar
      </NuxtLink>
      <h1 class="text-sm font-medium text-neutral-700 select-none">Chat</h1>
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
        class="flex items-center justify-center h-full text-sm text-neutral-400 select-none"
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
                ? 'bg-neutral-900 text-white'
                : 'bg-white border border-neutral-200 text-neutral-900',
            ]"
          >
            <span class="sr-only">{{ msg.role === "user" ? "You" : "Assistant" }}: </span>
            <span class="whitespace-pre-wrap">{{ messageText(msg) }}</span>
          </div>

          <!-- Tool notes (assistant only) -->
          <ul
            v-if="msg.role === 'assistant' && toolNotes(msg).length > 0"
            class="flex flex-wrap gap-x-3 gap-y-0.5 px-1"
            aria-label="Tool actions"
          >
            <li
              v-for="note in toolNotes(msg)"
              :key="note.key"
              class="text-xs text-neutral-400 tabular-nums select-none"
            >
              {{ note.label }}
            </li>
          </ul>
        </li>

        <!-- Streaming indicator -->
        <li v-if="isStreaming" class="flex items-start" aria-label="Assistant is typing">
          <div
            class="bg-white border border-neutral-200 rounded px-3 py-2 text-sm text-neutral-400
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
        class="mt-4 text-sm text-center text-neutral-500"
      >
        Something went wrong. Please try again.
      </p>
    </main>

    <!-- Input area -->
    <footer class="border-t border-neutral-200 bg-white px-4 py-3 shrink-0">
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
          class="flex-1 resize-none rounded border border-neutral-200 bg-neutral-50 px-3 py-2
                 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors disabled:opacity-50"
          :disabled="isStreaming"
          @keydown="handleKeydown"
        />
        <button
          type="submit"
          class="self-end px-4 py-2 rounded border border-neutral-900 bg-neutral-900 text-white
                 text-sm font-medium hover:bg-neutral-700 focus-visible:outline-none
                 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2
                 motion-safe:transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isStreaming || !input.trim()"
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    </footer>
  </div>
</template>
