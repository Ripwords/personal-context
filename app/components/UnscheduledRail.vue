<script setup lang="ts">
export interface UnscheduledTodo {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
}

defineProps<{
  todos: UnscheduledTodo[];
  projectColorMap: Record<string, string>;
}>();

const emit = defineEmits<{
  drop: [id: string];
  "clear-all": [];
}>();
</script>

<template>
  <aside class="flex flex-col gap-1 px-3 py-4 overflow-y-auto" aria-label="Unscheduled tasks">
    <div class="flex items-center justify-between px-2 mb-2">
      <p class="text-[10px] font-semibold tracking-widest uppercase text-neutral-400">
        Inbox
      </p>
      <button
        v-if="todos.length > 0"
        type="button"
        class="text-[10px] font-medium text-neutral-400 hover:text-neutral-700
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
               motion-safe:transition-colors"
        @click="emit('clear-all')"
      >
        Clear all
      </button>
    </div>

    <ul class="flex flex-col gap-1">
      <li
        v-for="todo in todos"
        :key="todo.id"
        class="group flex items-start gap-2 rounded border border-neutral-200 px-3 py-2 bg-white
               text-sm text-neutral-800 cursor-default select-none"
      >
        <!-- project colour tick -->
        <span
          v-if="todo.projectId && projectColorMap[todo.projectId]"
          class="mt-0.5 shrink-0 w-0.5 h-4 rounded-full"
          :style="{ backgroundColor: projectColorMap[todo.projectId] }"
          aria-hidden="true"
        />
        <span class="leading-snug break-words flex-1">{{ todo.title }}</span>
        <button
          type="button"
          class="shrink-0 text-neutral-300 opacity-0 group-hover:opacity-100
                 hover:text-neutral-700 focus-visible:opacity-100 focus-visible:outline-none
                 focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
                 motion-safe:transition-opacity"
          :aria-label="`Clear ${todo.title}`"
          @click="emit('drop', todo.id)"
        >
          ✕
        </button>
      </li>
    </ul>

    <p v-if="todos.length === 0" class="px-2 text-xs text-neutral-400">
      All tasks scheduled.
    </p>
  </aside>
</template>
