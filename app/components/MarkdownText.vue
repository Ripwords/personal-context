<script setup lang="ts">
import { computed } from "vue";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

const props = defineProps<{ content: string }>();

const md = new MarkdownIt({
  html: false, // XSS prevention: never pass raw HTML through
  linkify: true,
  breaks: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs-pre"><code class="hljs">' +
          hljs.highlight(code, { language: lang, ignoreIllegals: true }).value +
          "</code></pre>"
        );
      } catch {
        // fall through
      }
    }
    return (
      '<pre class="hljs-pre"><code class="hljs">' +
      hljs.highlightAuto(code).value +
      "</code></pre>"
    );
  },
});

// Make all links open in a new tab safely
const defaultLinkOpen = md.renderer.rules["link_open"];
md.renderer.rules["link_open"] = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet("target", "_blank");
  tokens[idx]!.attrSet("rel", "noopener noreferrer");
  if (defaultLinkOpen) {
    return defaultLinkOpen(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

const html = computed(() => md.render(props.content));
</script>

<template>
  <!-- v-html is intentional: markdown-it renders to escaped HTML with html:false -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="md-prose" v-html="html" />
</template>

<style scoped>
/* Monochrome prose styling for assistant markdown output */
.md-prose :deep(h1),
.md-prose :deep(h2),
.md-prose :deep(h3),
.md-prose :deep(h4),
.md-prose :deep(h5),
.md-prose :deep(h6) {
  font-weight: 600;
  margin-top: 0.75em;
  margin-bottom: 0.25em;
}

.md-prose :deep(h1) { font-size: 1.25rem; }
.md-prose :deep(h2) { font-size: 1.1rem; }
.md-prose :deep(h3) { font-size: 1rem; }

.md-prose :deep(p) {
  margin-bottom: 0.5em;
}
.md-prose :deep(p:last-child) {
  margin-bottom: 0;
}

.md-prose :deep(ul),
.md-prose :deep(ol) {
  margin-left: 1.25em;
  margin-bottom: 0.5em;
  list-style: revert;
}

.md-prose :deep(li) {
  margin-bottom: 0.15em;
}

.md-prose :deep(strong) {
  font-weight: 600;
}

.md-prose :deep(em) {
  font-style: italic;
}

.md-prose :deep(blockquote) {
  border-left: 3px solid #d4d4d4;
  padding-left: 0.75em;
  margin-left: 0;
  color: #737373;
}

.md-prose :deep(a) {
  text-decoration: underline;
  color: inherit;
}
.md-prose :deep(a:hover) {
  opacity: 0.75;
}

.md-prose :deep(code):not(pre code) {
  background: #f5f5f5;
  border: 1px solid #e5e5e5;
  border-radius: 3px;
  padding: 0.1em 0.35em;
  font-size: 0.875em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.md-prose :deep(.hljs-pre) {
  background: #f5f5f5;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5em 0;
  padding: 0.75em 1em;
}

.md-prose :deep(.hljs-pre code) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre;
}

.md-prose :deep(img) {
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid #e5e5e5;
  margin: 0.25em 0;
}

.md-prose :deep(hr) {
  border: none;
  border-top: 1px solid #e5e5e5;
  margin: 0.75em 0;
}

.md-prose :deep(table) {
  border-collapse: collapse;
  font-size: 0.875em;
  margin-bottom: 0.5em;
  width: 100%;
}
.md-prose :deep(th),
.md-prose :deep(td) {
  border: 1px solid #e5e5e5;
  padding: 0.3em 0.6em;
  text-align: left;
}
.md-prose :deep(th) {
  background: #f5f5f5;
  font-weight: 600;
}
</style>
