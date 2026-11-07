import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VIEW_BUNDLE_DEDUPE } from "@miragon/pulse-widget-shell/server"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // LOAD-BEARING: widget-shell's list of what the view bundle must resolve to
    // ONE instance (React, TanStack Query, mcp-use, the kit @miragon/pulse-ui,
    // the view runtime @miragon/pulse-widget-shell, lucide-react). The modules
    // each resolve their own pnpm instance of these; bundling two copies gives
    // each its own React context, a widget's `useViewHost()`/`useToolQuery()`
    // reads the wrong one (no view host, no QueryClient), and every in-widget
    // query hangs on "Loading…". Spread it whole and never trim it; a package
    // of your own that carries a React context goes after it.
    dedupe: [...VIEW_BUNDLE_DEDUPE],
  },
  build: {
    // Two-file output (ES module + stylesheet) for the boot's `bundle`
    // (`createComposedServer` inlines both into every view), with all assets
    // inlined so the bundle stays self-contained inside the sandboxed view
    // iframe.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    // Every view inlines the whole bundle, so it stays ONE file by design: never
    // code-split it. Vite's 500 kB hint does not fit it; 2000 kB is its size
    // alarm instead: a bundle past it costs every render, so trim what the
    // widgets import rather than splitting it.
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
