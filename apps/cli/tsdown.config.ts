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
  // Only legal comments (/*!, @license, @preserve) and the line naming each module's source stay:
  // rolldown drops plain comments anyway, and this drops JSDoc and the @__PURE__ marks too. The
  // code stays readable, not minified, within its byte budget (test/__golden__/bundle-budget.json).
  // The standalone bundle takes the same (tsdown.standalone.config.ts, scripts/bundles.test.ts).
  outputOptions: { comments: { legal: true, annotation: false, jsdoc: false } },
})
