# Chat Markdown + Rich Tool Results — Implementation Report

## Libraries used
- `markdown-it@14.2.0` — Markdown parser/renderer
- `highlight.js@11.11.1` — Syntax highlighting for fenced code blocks
- `@types/markdown-it@14.1.2` — TypeScript types (dev dep)
- `highlight.js/styles/github.css` — Light, neutral theme (via nuxt.config `css`)

## XSS Prevention
`html: false` is passed to `MarkdownIt()`. This instructs markdown-it to escape any raw HTML tags found in the input, so a malicious assistant message containing `<script>` or `<img onerror=...>` will be rendered as escaped text, not executed. `v-html` is only used on the output of this safe render pipeline. Links are rewritten to add `target="_blank" rel="noopener noreferrer"` via a render rule.

## Tool render approach
Each tool part is extracted from `msg.parts` via `isDynamicToolUIPart`/`isStaticToolUIPart`. The `ToolPart` interface holds `output: unknown`; typed accessor functions (`asWebSearch`, etc.) perform a single `as` cast after branching on `toolName`. In the template, `v-else-if="tp.toolName === 'web_search'"` gates each tool block so the cast is structurally sound. Unknown/mid-flight tool states show "· running <toolname>…".

## Per-tool rendering
- **web_search**: unconfigured → shows `note` text; configured → clickable result cards with title, truncated URL, snippet
- **search_documents**: bordered cards with filename label + content excerpt (`line-clamp-3`)
- **search_memory**: bulleted list of memory strings (or "no memories found")
- **create_todo**: subtle chip "✓ created todo: <title>"
- **create_event**: "✓ created event: <title>" or muted error note if `error` is set
- **read_calendar**: compact table header (N events, N scheduled, N unscheduled) + event list with formatted times (tabular-nums)

## Typecheck + test results
- `bunx nuxi typecheck` → exit 0 (no errors)
- `bun test` → 122 pass, 0 fail (unchanged)
- Dev server serves `/chat` with 302→HTML (Nuxt SSR + auth redirect, expected)

## Concerns
- `highlight.js` registers all bundled languages by default, adding ~900 KB to the client bundle. Tree-shaking is possible by importing only needed languages, but left as a future optimization.
- The `v-html` in `MarkdownText.vue` is safe under `html: false` but will need a CSP `script-src` header if strict CSP is later added.
- `line-clamp-3` requires Tailwind CSS v3+ JIT; this project already uses Tailwind so it should work.
