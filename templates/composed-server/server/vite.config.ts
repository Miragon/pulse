import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // LOAD-BEARING — never trim this list. The widget packages each resolve
    // their own pnpm instance of React, TanStack Query, mcp-use and the
    // toolkit; bundling two copies gives each its own React context, a
    // widget's `useViewHost()`/`useToolQuery()` reads the wrong one (no view
    // host, no QueryClient), and every in-widget query hangs on "Loading…".
    // Dedupe collapses them to a single instance. @miragon/pulse-widget-shell
    // is listed because it is installed from npm here and carries the view
    // runtime's React contexts.
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "mcp-use",
      "@miragon/mcp-toolkit-ui",
      "@miragon/mcp-toolkit-core",
      "@miragon/pulse-widget-shell",
      // The kit's Lucide icons and the toolkit's: one instance.
      "lucide-react",
    ],
  },
  build: {
    // Two-file output (ES module + stylesheet) for the boot's `bundle`
    // (`createComposedServer` inlines both into every view), with all assets
    // inlined so the bundle stays self-contained inside the sandboxed view
    // iframe.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./src/ui/main.tsx", import.meta.url)),
      output: {
        entryFileNames: "mcp-app.js",
        assetFileNames: "mcp-app.[ext]",
        inlineDynamicImports: true,
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
})
