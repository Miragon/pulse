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
          name: "unit",
          environment: "node",
          include: [
            "test/contract/**/*.test.ts",
            "test/core/**/*.test.ts",
            "test/adapters/**/*.test.ts",
            "test/model/**/*.test.ts",
          ],
          exclude: ["test/**/*.engine.test.ts"],
        },
      },
    ],
  },
})
