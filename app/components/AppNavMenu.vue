<script setup lang="ts">
import { ref, computed } from "vue";
import { authClient } from "~/lib/auth-client";

// Single source of truth for app navigation. Shown as the ⋯ overflow menu in
// every page header so the whole app is reachable from anywhere (previously most
// pages only had a one-way "← Calendar" link).
const navLinks = [
  { to: "/", label: "Calendar" },
  { to: "/chat", label: "Chat" },
  { to: "/dump", label: "Brain dump" },
  { to: "/wind-down", label: "Wind down" },
  { to: "/memories", label: "Memory" },
  { to: "/documents", label: "Documents" },
  { to: "/analytics", label: "Analytics" },
  { to: "/settings", label: "Settings" },
] as const;

const route = useRoute();
const menuOpen = ref(false);
const currentPath = computed(() => route.path);

async function handleSignOut(): Promise<void> {
  await authClient.signOut();
  await navigateTo("/login");
}
</script>

<template>
  <div class="relative shrink-0">
    <button
      type="button" aria-label="Menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"
      class="w-8 h-8 flex items-center justify-center rounded-full bd-surface-2 bd-text text-sm
             hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
    >⋯</button>
    <template v-if="menuOpen">
      <div class="fixed inset-0 z-10" @click="menuOpen = false" />
      <div class="absolute right-0 mt-1 w-44 z-20 rounded-lg border bd-border bd-surface py-1 shadow-xl shadow-black/40">
        <NuxtLink
          v-for="l in navLinks" :key="l.to" :to="l.to" @click="menuOpen = false"
          class="block px-3 py-1.5 text-sm bd-hover motion-safe:transition-colors"
          :class="currentPath === l.to
            ? 'text-[var(--bd-text)] font-medium bg-[var(--bd-surface-2)]'
            : 'bd-muted hover:text-[var(--bd-text)]'"
        >{{ l.label }}</NuxtLink>
        <div class="my-1 border-t bd-border" />
        <button
          type="button" @click="handleSignOut"
          class="block w-full text-left px-3 py-1.5 text-sm bd-muted hover:text-[var(--bd-text)] bd-hover motion-safe:transition-colors"
        >Sign out</button>
      </div>
    </template>
  </div>
</template>
