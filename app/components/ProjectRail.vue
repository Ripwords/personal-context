<script setup lang="ts">
export interface Project {
  id: string;
  name: string;
  color: string;
  kind: string;
}

const props = defineProps<{
  projects: Project[];
  activeIds: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [id: string];
}>();
</script>

<template>
  <nav
    class="flex flex-col gap-1 px-3 py-4 overflow-y-auto"
    aria-label="Projects"
  >
    <p class="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 px-2 mb-2">
      Projects
    </p>

    <button
      v-for="project in projects"
      :key="project.id"
      type="button"
      class="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors
             hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2
             focus-visible:ring-neutral-900"
      :class="activeIds.has(project.id) ? 'text-neutral-900' : 'text-neutral-400'"
      :aria-pressed="activeIds.has(project.id)"
      @click="emit('toggle', project.id)"
    >
      <!-- colour tick -->
      <span
        class="shrink-0 w-0.5 h-4 rounded-full"
        :style="{ backgroundColor: project.color }"
        aria-hidden="true"
      />
      <span class="truncate">{{ project.name }}</span>
    </button>

    <p v-if="projects.length === 0" class="px-2 text-xs text-neutral-400">
      No projects yet.
    </p>
  </nav>
</template>
