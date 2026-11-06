import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VIEW_BUNDLE_DEDUPE } from "@miragon/pulse-widget-shell/server"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // LOAD-BEARING (CLAUDE.md invariant 4): widget-shell's list of what the view bundle must
    // resolve to ONE instance (React, TanStack Query, mcp-use, the kit, the view runtime,
    // lucide-react). Each copy carries its own React context, so a second one leaves a widget
    // without a view host and a QueryClient, and every in-widget query hangs on "Loading…".
    // Spread it whole; add to it, never trim it. The lucide-react devDependency this app pins
    // is load-bearing twice: it also keeps mcp-use's lucide peer on ONE pnpm instance (mcp-use 2
    // migration guide §1; without it the view runtime exists twice).
    dedupe: [...VIEW_BUNDLE_DEDUPE],
  },
  build: {
    // Two-file output (ES module + stylesheet) for the boot's
    // `bundle`, the mcp-use 2 native-view shape (the 1.x single-file
    // HTML via vite-plugin-singlefile is gone). Assets stay inlined so the
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
