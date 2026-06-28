<script setup lang="ts">
import { authClient } from "~/lib/auth-client";

type ConnectionRole = "personal" | "work";

interface Connection {
  accountId: string;
  role: ConnectionRole;
  braindumpCalendarId: string | null;
}

const { data: connections, refresh } = await useFetch<Connection[]>("/api/connections");

async function addWorkAccount() {
  await authClient.linkSocial({ provider: "google", callbackURL: "/connections" });
}

async function setRole(accountId: string, role: ConnectionRole) {
  await $fetch("/api/connections/role", {
    method: "POST",
    body: { accountId, role },
  });
  await refresh();
}
</script>

<template>
  <main class="min-h-dvh bg-neutral-50 text-neutral-900">
    <div class="mx-auto max-w-xl px-6 py-16 flex flex-col gap-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold tracking-tight">Connected accounts</h1>
        <UButton color="neutral" variant="outline" size="sm" @click="addWorkAccount">
          Add work account
        </UButton>
      </div>

      <ul v-if="connections && connections.length > 0" class="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
        <li
          v-for="conn in connections"
          :key="conn.accountId"
          class="flex items-center justify-between px-4 py-3 bg-white"
        >
          <span class="text-sm font-mono text-neutral-600 truncate max-w-xs">{{ conn.accountId }}</span>
          <div class="flex items-center gap-2 ml-4 shrink-0">
            <UButton
              size="xs"
              :color="conn.role === 'personal' ? 'neutral' : 'neutral'"
              :variant="conn.role === 'personal' ? 'solid' : 'outline'"
              @click="setRole(conn.accountId, 'personal')"
            >
              Personal
            </UButton>
            <UButton
              size="xs"
              :color="conn.role === 'work' ? 'neutral' : 'neutral'"
              :variant="conn.role === 'work' ? 'solid' : 'outline'"
              @click="setRole(conn.accountId, 'work')"
            >
              Work
            </UButton>
          </div>
        </li>
      </ul>

      <p v-else class="text-sm text-neutral-400">No connected accounts yet.</p>
    </div>
  </main>
</template>
