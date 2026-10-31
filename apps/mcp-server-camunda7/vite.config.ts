import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The widget packages (camunda7-connector, widget-shell, analytics-connector) and this
    // app each resolve their own pnpm instance of the toolkit/React/Query libs
    // (differing peer-dep hashes). Bundling multiple copies of @miragon/mcp-
    // toolkit-ui gives each its own React context: McpAppView (this app's copy)
    // sets the AppQueryProvider's CallToolContext, but a widget's useToolQuery
    // (its package's copy) reads a *different* context → useCallTool() is
    // undefined → every in-widget query is disabled and hangs on "Loading…".
    // Same trap since mcp-use 2 for the module-scoped view runtime in
    // `mcp-use/react` (the guide's "hooks require a browser view" crash).
    // Dedupe collapses them to a single instance so the context matches.
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
