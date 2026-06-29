<script setup lang="ts">
import { authClient } from "~/lib/auth-client";

type ConnectionRole = "personal" | "work";

interface Connection {
  accountId: string;
  email: string | null;
  role: ConnectionRole;
  braindumpCalendarId: string | null;
}

const { data: connections, refresh } = await useFetch<Connection[]>("/api/connections");
const roleError = ref<string | null>(null);

// Show the account's email; fall back to a shortened id until the calendar syncs.
function accountLabel(c: Connection): string {
  return c.email ?? `${c.accountId.slice(0, 10)}… (sign-in syncs email)`;
}

async function addAccount() {
  await authClient.linkSocial({ provider: "google", callbackURL: "/settings" });
}

async function setRole(accountId: string, role: ConnectionRole) {
  roleError.value = null;
  try {
    await $fetch("/api/connections/role", {
      method: "POST",
      body: { accountId, role },
    });
    await refresh();
  } catch (err) {
    roleError.value = err instanceof Error ? err.message : "Failed to update role";
  }
}
</script>

<template>
  <main class="min-h-dvh bg-neutral-50 text-neutral-900">
    <div class="mx-auto max-w-xl px-6 py-16 flex flex-col gap-10">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
        <NuxtLink
          to="/"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Back to calendar
        </NuxtLink>
      </div>

      <section class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-neutral-700">Connected Google accounts</h2>
          <UButton color="neutral" variant="outline" size="sm" @click="addAccount">
            Add account
          </UButton>
        </div>

        <p v-if="roleError" class="text-xs text-red-600">{{ roleError }}</p>

        <ul v-if="connections && connections.length > 0" class="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
          <li
            v-for="conn in connections"
            :key="conn.accountId"
            class="flex items-center justify-between px-4 py-3 bg-white"
          >
            <span class="text-sm text-neutral-700 truncate max-w-xs">{{ accountLabel(conn) }}</span>
            <div class="flex items-center gap-2 ml-4 shrink-0">
              <UButton
                size="xs"
                color="neutral"
                :variant="conn.role === 'personal' ? 'solid' : 'outline'"
                @click="setRole(conn.accountId, 'personal')"
              >
                Personal
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                :variant="conn.role === 'work' ? 'solid' : 'outline'"
                @click="setRole(conn.accountId, 'work')"
              >
                Work
              </UButton>
            </div>
          </li>
        </ul>

        <p v-else class="text-sm text-neutral-400">No connected accounts yet.</p>
      </section>
    </div>
  </main>
</template>
