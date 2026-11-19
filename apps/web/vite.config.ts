import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VIEW_BUNDLE_DEDUPE } from "@miragon/pulse-widget-shell/server"
import { PAGE_PATTERNS } from "./src/pages.js"

/**
 * The build's `pages.json`, `{ "pages": [...] }`: the routes the server answers with the page
 * (src/pages.ts), which it reads from the build at boot.
 */
function pagesManifest(): Plugin {
  return {
    name: "pulse-web-pages",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "pages.json",
        source: `${JSON.stringify({ pages: PAGE_PATTERNS }, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  // The server serves the build under /app: the page's asset URLs start there (/app/assets/…).
  base: "/app/",
  plugins: [react(), tailwindcss(), pagesManifest()],
  resolve: {
    // LOAD-BEARING (CLAUDE.md invariant 4): widget-shell's list of what a view bundle must resolve
    // to ONE instance (React, TanStack Query, the kit, the view runtime, lucide-react). Each copy
    // carries its own React context, so a second one leaves a widget without a view host and a
    // QueryClient, and every in-widget query hangs on "Loading…". Spread it whole; never trim it.
    dedupe: [...VIEW_BUNDLE_DEDUPE],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The server serves the files of assets/ alone, each immutable for a year under its hashed
    // name, and its Content Security Policy runs scripts of the page's own origin only: every
    // asset is a file of its own, nothing inlined into the page or the stylesheet as a data URL.
    assetsDir: "assets",
    assetsInlineLimit: 0,
    // Every browser the page runs in preloads a module itself: no polyfill in the script.
    modulePreload: { polyfill: false },
    // The page carries the whole cockpit, as the view bundle does; its gzip ceiling is
    // test/__golden__/bundle-budget.json.
    chunkSizeWarningLimit: 2000,
  },
})
