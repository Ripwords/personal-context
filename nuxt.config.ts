export default defineNuxtConfig({
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  future: { compatibilityVersion: 4 },
  runtimeConfig: {
    databaseUrl: "", // set via NUXT_DATABASE_URL
  },
  devtools: { enabled: true },
});
