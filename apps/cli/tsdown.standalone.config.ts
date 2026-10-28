// Standalone bundle: one CommonJS file with every runtime dependency inlined, the
// main script of the single executable applications (scripts/build-exe.ts) and of the container
// image (Dockerfile). Node.js 24 runs a SEA main script only as CommonJS. The npm package keeps
// its own ESM build (tsdown.config.ts) with commander as a dependency.
import { defineConfig } from "tsdown"
import pkg from "./package.json" with { type: "json" }

export default defineConfig({
  entry: { "pulse-cli": "src/bin/pulse-cli.ts" },
  format: "cjs",
  platform: "node",
  target: "node24",
  outDir: "build/standalone",
  clean: true,
  dts: false,
  sourcemap: false,
  loader: { ".md": "text" },
  fixedExtension: true,
  // nothing is loaded from node_modules at run time: a SEA can load only built-in modules
  deps: { alwaysBundle: Object.keys(pkg.dependencies), onlyBundle: false },
  // CommonJS on purpose (see above), not a library format choice
  checks: { legacyCjs: false },
})
