import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { "pulse-cli": "src/bin/pulse-cli.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  loader: { ".md": "text" },
  fixedExtension: false,
})
