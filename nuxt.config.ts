export default defineNuxtConfig({
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css", "highlight.js/styles/github.css"],
  future: { compatibilityVersion: 4 },
  devtools: { enabled: true },
});
