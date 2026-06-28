<script setup lang="ts">
import { authClient } from "~/lib/auth-client";

async function signin() {
  await authClient.signIn.social({ provider: "google", callbackURL: "/" });
}
</script>

<template>
  <main class="min-h-dvh flex flex-col items-center justify-center gap-6 bg-neutral-50 text-neutral-900">
    <h1 class="text-3xl font-semibold tracking-tight">Braindump</h1>
    <p class="text-sm text-neutral-500">Dump everything. Wake up to a plan.</p>
    <UButton color="neutral" size="lg" @click="signin">Continue with Google</UButton>
  </main>
</template>
