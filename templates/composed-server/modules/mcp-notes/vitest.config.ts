import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Node by default; a widget test opts into a DOM with `// @vitest-environment happy-dom`.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // Run the @miragon/pulse-* packages through Vite's resolver instead of
        // native Node ESM: in the Pulse monorepo they are workspace-linked
        // (and thus transformed), from npm they would be externalized, and
        // widget-shell's dist uses bundler-style extensionless imports
        // (bpmn-js/lib/NavigatedViewer) that plain Node cannot resolve.
        inline: [/@miragon\/pulse-/],
      },
    },
  },
})
