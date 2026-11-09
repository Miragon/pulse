import { join } from "node:path"
import { defineConfig } from "vitest/config"
import { bpmnAsText } from "./vitest.config"

const MAC_RESOURCES = "/Applications/Orca.app/Contents/Resources"
const resources = process.env.ORCA_RESOURCES ?? MAC_RESOURCES
const declarative = join(resources, "app.asar.unpacked/resources/plugins/declarative")

export default defineConfig({
  plugins: [bpmnAsText],
  resolve: {
    alias: [
      { find: /^orca\/testing$/, replacement: join(declarative, "orca-testing.mjs") },
      { find: /^orca\/jsx-runtime$/, replacement: join(declarative, "orca-runtime.mjs") },
      { find: /^orca\/jsx-dev-runtime$/, replacement: join(declarative, "orca-runtime.mjs") },
      { find: /^orca$/, replacement: join(declarative, "orca-runtime.mjs") },
    ],
  },
  oxc: { jsx: { runtime: "automatic", importSource: "orca" } },
  test: {
    name: "orca-kit",
    environment: "node",
    include: ["test/kit/**/*.orca.test.{ts,tsx}"],
  },
})
