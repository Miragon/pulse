import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The widget packages (camunda7-connector, widget-shell, analytics-connector) and this
    // app each resolve their own pnpm instance of React, TanStack Query, mcp-use and the
    // toolkit (differing peer-dep hashes). Bundling several copies gives each its own React
    // context: the view root (widget-shell's copy) provides the view host and the ONE
    // QueryClient, but a widget's `useViewHost`/`useToolQuery` would read a *different*
    // context → no client, no host → every in-widget query hangs on "Loading…". Same trap
    // for the module-scoped view runtime in `mcp-use/react` (the guide's "hooks require a
    // browser view" crash). Dedupe collapses them to a single instance so the context matches.
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "mcp-use",
      "@miragon/mcp-toolkit-ui",
      "@miragon/mcp-toolkit-core",
      // The kit's Lucide icons and the toolkit's: one copy in the bundle, the
      // version this app pins. That devDependency is load-bearing twice: it
      // also keeps mcp-use's lucide peer on ONE pnpm instance (mcp-use 2
      // migration guide §1; without it the view runtime exists twice).
      "lucide-react",
    ],
  },
  build: {
    // Two-file output (ES module + stylesheet) for the boot's
    // `bundle` — the mcp-use 2 native-view shape (the 1.x single-file
    // HTML via vite-plugin-singlefile is gone). Assets stay inlined so the
    // bundle remains self-contained inside the sandboxed view iframe.
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
