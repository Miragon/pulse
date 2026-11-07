import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VIEW_BUNDLE_DEDUPE, viewBundleWatchPlugin } from "@miragon/pulse-widget-shell/server"

export default defineConfig({
  // `pnpm dev` builds the bundle, then `vite build --watch` rebuilds it next to `tsx watch`, which
  // restarts the server on every write: the plugin leaves an unchanged output unwritten, so the
  // watcher's first build restarts nothing.
  plugins: [react(), tailwindcss(), viewBundleWatchPlugin()],
  resolve: {
    // LOAD-BEARING (CLAUDE.md invariant 4): widget-shell's list of what the view bundle must
    // resolve to ONE instance (React, TanStack Query, the kit, the view runtime, lucide-react).
    // Each copy carries its own React context, so a second one leaves a widget without a view
    // host and a QueryClient, and every in-widget query hangs on "Loading…". Spread it whole;
    // add to it, never trim it. The lucide-react devDependency this app pins is load-bearing
    // twice: pnpm installs pulse-ui and widget-shell once per peer set, so a second lucide-react
    // version would give the view runtime a second instance (CLAUDE.md invariant 6).
    dedupe: [...VIEW_BUNDLE_DEDUPE],
  },
  build: {
    // Two-file output (ES module + stylesheet) for the boot's `bundle`
    // (`createComposedServer` inlines both into every view). Assets stay inlined so the
    // bundle remains self-contained inside the sandboxed view iframe.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    // Every view inlines the one file, so it is never code-split and Vite's 500 kB hint does
    // not apply; its size gate is test/__golden__/bundle-budget.json (gzip, test:host).
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: fileURLToPath(new URL("./src/ui/main.tsx", import.meta.url)),
      output: {
        entryFileNames: "mcp-app.js",
        assetFileNames: "mcp-app.[ext]",
        codeSplitting: false,
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
})
