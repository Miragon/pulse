import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config"
import base from "./vitest.config"

const merged: ViteUserConfig = mergeConfig(
  base,
  defineConfig({ test: { coverage: { enabled: false } } }),
)

export default defineConfig({
  ...merged,
  test: {
    ...merged.test,
    projects: [
      {
        extends: true,
        test: {
          name: "engines",
          environment: "node",
          include: ["test/**/*.engine.test.ts"],
          testTimeout: 180_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
