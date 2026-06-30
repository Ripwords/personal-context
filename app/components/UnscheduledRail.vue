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
  complete: [id: string];
  "clear-all": [];
}>();

// Drag-to-schedule: carry the todo id; the calendar grid reads it on drop.
function onDragStart(e: DragEvent, id: string): void {
  e.dataTransfer?.setData("application/x-braindump-todo", id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
</script>

<template>
  <aside class="flex flex-col gap-1 px-3 py-4 overflow-y-auto" aria-label="Unscheduled tasks">
    <div class="flex items-center justify-between px-2 mb-2">
      <p class="text-[10px] font-semibold tracking-widest uppercase bd-faint">
        Inbox
      </p>
      <button
        v-if="todos.length > 0"
        type="button"
        class="text-[10px] font-medium bd-faint hover:text-[var(--bd-text)]
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
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
        draggable="true"
        class="group flex items-start gap-2 rounded border bd-border bd-surface-2 px-3 py-2
               text-sm bd-text cursor-grab active:cursor-grabbing select-none"
        @dragstart="onDragStart($event, todo.id)"
      >
        <!-- complete checkbox -->
        <button
          type="button"
          class="mt-0.5 shrink-0 w-4 h-4 rounded-full border bd-border
                 flex items-center justify-center text-[10px] leading-none
                 hover:border-[var(--bd-text)] hover:text-[var(--bd-text)] bd-faint
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500
                 motion-safe:transition-colors"
          :aria-label="`Complete ${todo.title}`"
          @click="emit('complete', todo.id)"
        >
          <span class="opacity-0 group-hover:opacity-100 motion-safe:transition-opacity">✓</span>
        </button>
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
          class="shrink-0 bd-faint opacity-0 group-hover:opacity-100
                 hover:text-[var(--bd-text)] focus-visible:opacity-100 focus-visible:outline-none
                 focus-visible:ring-2 focus-visible:ring-neutral-500 rounded
                 motion-safe:transition-opacity"
          :aria-label="`Clear ${todo.title}`"
          @click="emit('drop', todo.id)"
        >
          ✕
        </button>
      </li>
    </ul>

    <p v-if="todos.length === 0" class="px-2 text-xs bd-faint">
      All tasks scheduled.
    </p>
  </aside>
</template>
