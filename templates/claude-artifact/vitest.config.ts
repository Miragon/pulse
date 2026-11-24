import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

/**
 * `pnpm test`: the data layer in Node, the page in happy-dom (`// @vitest-environment happy-dom`
 * in its file), the bundle over dist/ (`pnpm test` builds first), the brand gates over src. No
 * network, no browser, no live server.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 30_000,
    // widget-shell's view half imports bpmn-js without file extensions, as a bundler resolves
    // them; Node does not, so Vite transforms it in the tests as it does in the build.
    server: { deps: { inline: [/@miragon\/pulse-widget-shell/] } },
  },
})
