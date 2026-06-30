<script setup lang="ts">
// Standard app header bar, matching the calendar's top bar (h-14, prominent
// title, ⋯ nav menu on the right). Use the `actions` slot for page-specific
// controls that sit just before the nav menu.
defineProps<{ title: string }>();
</script>

<template>
  <header class="flex items-center gap-4 px-4 h-14 border-b bd-border bd-surface shrink-0">
    <h1 class="text-lg font-semibold tracking-tight whitespace-nowrap select-none">
      {{ title }}
    </h1>
    <div class="flex-1 min-w-0 flex items-center justify-end gap-2">
      <slot name="actions" />
    </div>
    <AppNavMenu />
  </header>
</template>
