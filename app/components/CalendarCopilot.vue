<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useChat } from "@ai-sdk/vue";
import {
  DefaultChatTransport,
  isDynamicToolUIPart,
  isStaticToolUIPart,
  type UIMessage,
} from "ai";
import { newMutationCallIds, type ToolPartLike } from "~/utils/copilot";

// Emitted whenever the assistant successfully creates/edits/deletes a calendar
// item, so the parent can refresh the timeline.
const emit = defineEmits<{ changed: [] }>();

const open = ref(false);
const input = ref("");
const scrollEl = ref<HTMLElement | null>(null);

// Ephemeral: no sessionId, `ephemeral: true` tells /api/chat to skip persistence.
const { messages, sendMessage, status, error } = useChat({
  transport: new DefaultChatTransport({
    api: "/api/chat",
    body: () => ({
      ephemeral: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  }),
});

const isStreaming = computed(
  () => status.value === "submitted" || status.value === "streaming",
);

function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Flatten the AI SDK tool parts of one message into the shape our detector needs. */
function toolPartsOf(msg: UIMessage): ToolPartLike[] {
  const parts: ToolPartLike[] = [];
  for (const part of msg.parts) {
    if (isDynamicToolUIPart(part)) {
      parts.push({ toolName: part.toolName, toolCallId: part.toolCallId, state: part.state, output: part.output });
    } else if (isStaticToolUIPart(part)) {
      const toolName = (part.type as string).replace(/^tool-/, "");
      parts.push({ toolName, toolCallId: part.toolCallId, state: part.state, output: part.output });
    }
  }
  return parts;
}

// Refresh the calendar exactly once per successful mutation. `seen` guards
// against the deep watcher re-firing as the stream updates other fields.
const seen = new Set<string>();
watch(
  messages,
  async () => {
    const allParts = messages.value.flatMap(toolPartsOf);
    const fresh = newMutationCallIds(allParts, seen);
    if (fresh.length > 0) {
      for (const id of fresh) seen.add(id);
      emit("changed");
    }
    await nextTick();
    scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight, behavior: "smooth" });
  },
  { deep: true },
);

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text || isStreaming.value) return;
  input.value = "";
  await sendMessage({ role: "user", parts: [{ type: "text", text }] });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void submit();
  }
}

function toggle(): void {
  open.value = !open.value;
  if (open.value) {
    void nextTick(() => {
      scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight });
    });
  }
}
</script>

<template>
  <div class="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-3">
    <!-- Popover panel -->
    <Transition
      enter-active-class="motion-safe:transition motion-safe:duration-150"
      leave-active-class="motion-safe:transition motion-safe:duration-100"
      enter-from-class="opacity-0 translate-y-2"
      leave-to-class="opacity-0 translate-y-2"
    >
      <section
        v-if="open"
        class="w-[360px] h-[480px] flex flex-col rounded-xl border bd-border bd-surface shadow-2xl shadow-black/40 overflow-hidden"
        aria-label="Calendar copilot"
      >
        <!-- Panel header -->
        <header class="flex items-center justify-between px-3 h-11 border-b bd-border shrink-0">
          <span class="text-sm font-semibold tracking-tight">Copilot</span>
          <div class="flex items-center gap-1">
            <NuxtLink
              to="/chat"
              class="text-xs bd-faint hover:text-[var(--bd-text)] px-1.5 py-0.5 rounded
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500
                     motion-safe:transition-colors"
            >Full chat →</NuxtLink>
            <button
              type="button" aria-label="Close copilot" @click="open = false"
              class="w-6 h-6 flex items-center justify-center rounded bd-faint bd-hover
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            >✕</button>
          </div>
        </header>

        <!-- Messages -->
        <div ref="scrollEl" class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <p v-if="messages.length === 0" class="text-xs bd-faint leading-relaxed select-none py-6 text-center">
            Ask me anything, or tell me to add, move, or cancel something on your calendar.
          </p>

          <div
            v-for="m in messages"
            :key="m.id"
            class="flex"
            :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed"
              :class="m.role === 'user'
                ? 'bg-[var(--bd-surface-2)] bd-text'
                : 'bd-muted'"
            >
              <span v-if="messageText(m)">{{ messageText(m) }}</span>
              <span v-else-if="m.role === 'assistant' && isStreaming" class="bd-faint italic">Working…</span>
            </div>
          </div>

          <p v-if="error" class="text-xs text-red-400">Something went wrong. Try again.</p>
        </div>

        <!-- Input -->
        <form class="flex items-end gap-2 p-2 border-t bd-border shrink-0" @submit.prevent="submit">
          <textarea
            v-model="input"
            rows="1"
            placeholder="Message copilot…"
            class="flex-1 resize-none max-h-24 rounded-lg border bd-border bd-bg px-3 py-2 text-sm bd-text
                   placeholder:bd-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            @keydown="onKeydown"
          />
          <button
            type="submit"
            :disabled="isStreaming || !input.trim()"
            aria-label="Send"
            class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--bd-surface-2)] bd-text
                   disabled:opacity-40 enabled:hover:opacity-90 motion-safe:transition-opacity
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
          >➤</button>
        </form>
      </section>
    </Transition>

    <!-- Floating toggle bubble -->
    <button
      type="button"
      :aria-label="open ? 'Close copilot' : 'Open copilot'"
      :aria-expanded="open"
      @click="toggle"
      class="w-12 h-12 rounded-full bd-surface-2 bd-text shadow-xl shadow-black/40 flex items-center justify-center
             text-lg hover:opacity-90 motion-safe:transition-opacity
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
    >{{ open ? "✕" : "💬" }}</button>
  </div>
</template>
