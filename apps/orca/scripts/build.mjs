import * as esbuild from "esbuild"
import { cp, mkdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { webviewBuildOptions } from "@miragon/pulse-runtime-view/webview-build-options"

const app = fileURLToPath(new URL("../", import.meta.url))
const here = `${app}src/`
const out = `${app}dist/`
const readable = { minify: false, sourcemap: false, logLevel: "warning" }

await rm(out, { recursive: true, force: true })
await mkdir(`${out}assets`, { recursive: true })

await Promise.all([
  esbuild.build({
    ...readable,
    entryPoints: [`${here}worker/main.ts`],
    outfile: `${out}worker.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    mainFields: ["module", "main"],
    external: ["orca", "orca/*"],
    loader: { ".bpmn": "text" },
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  }),
  esbuild.build({
    ...webviewBuildOptions({ production: false, outdir: `${out}editor` }),
    ...readable,
    metafile: false,
  }),
  esbuild.build({
    ...readable,
    entryPoints: [`${here}editor/bridge.ts`],
    outfile: `${out}editor/bridge.js`,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
  }),
  esbuild.build({
    ...readable,
    entryPoints: [`${here}panel/engines.tsx`],
    outfile: `${out}panel/engines.js`,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    external: ["orca", "orca/*"],
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "orca" } },
  }),
])

await cp(`${app}orca-plugin.json`, `${out}orca-plugin.json`)
await cp(`${here}editor/index.html`, `${out}editor/index.html`)
await cp(`${here}editor/board.html`, `${out}editor/board.html`)
await cp(`${app}media/icon.png`, `${out}assets/icon.png`)
await cp(`${app}images`, `${out}images`, { recursive: true })
console.log(`[pulse-orca] built ${out}`)
