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
</script>

<template>
  <aside class="flex flex-col gap-1 px-3 py-4 overflow-y-auto" aria-label="Unscheduled tasks">
    <p class="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 px-2 mb-2">
      Inbox
    </p>

    <ul class="flex flex-col gap-1">
      <li
        v-for="todo in todos"
        :key="todo.id"
        class="flex items-start gap-2 rounded border border-neutral-200 px-3 py-2 bg-white
               text-sm text-neutral-800 cursor-default select-none"
      >
        <!-- project colour tick -->
        <span
          v-if="todo.projectId && projectColorMap[todo.projectId]"
          class="mt-0.5 shrink-0 w-0.5 h-4 rounded-full"
          :style="{ backgroundColor: projectColorMap[todo.projectId] }"
          aria-hidden="true"
        />
        <span class="leading-snug break-words">{{ todo.title }}</span>
      </li>
    </ul>

    <p v-if="todos.length === 0" class="px-2 text-xs text-neutral-400">
      All tasks scheduled.
    </p>
  </aside>
</template>
