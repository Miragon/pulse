import { configDefaults, defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config"
import base from "./vitest.config"

/**
 * The connector's engine suite (`test:engines`, Docker): the conformance kit over the MCP
 * server's SDK wire against a real engine in a container (src/lib/core-adapter/
 * c7-runtime.engine.test.ts), which `pnpm test` leaves out. No coverage: the floors are the unit
 * run's.
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
