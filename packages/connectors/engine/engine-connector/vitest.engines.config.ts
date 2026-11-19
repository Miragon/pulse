import { configDefaults, defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config"
import base from "./vitest.config"

/**
 * The connector's engine suites (`test:engines`, Docker), which `pnpm test` leaves out: the
 * conformance kit against a real engine in a container, over the MCP server's SDK wire on a
 * Camunda 7 image (src/lib/core-adapter/c7-runtime.engine.test.ts) or over its own Camunda 8 wire
 * on a `camunda/camunda` image, locally only until #531 (c8-runtime.engine.test.ts); each skips on
 * the other dialect's image (`PULSE_ENGINE_IMAGE`). No coverage: the floors are the unit run's.
 */
const merged: ViteUserConfig = mergeConfig(
  base,
  defineConfig({ test: { coverage: { enabled: false } } }),
)

export default defineConfig({
  ...merged,
  test: {
    ...merged.test,
    include: ["src/**/*.engine.test.ts"],
    exclude: [...configDefaults.exclude],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
})
