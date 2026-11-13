import * as esbuild from "esbuild"
import { realpathSync } from "node:fs"
import { cp, mkdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { webviewBuildOptions } from "@miragon/pulse-runtime-view/webview-build-options"

const app = fileURLToPath(new URL("../", import.meta.url))
const here = `${app}src/`
const readable = { minify: false, sourcemap: false, logLevel: "warning" }

export const PLUGIN_FILES = {
  "orca-plugin.json": "orca-plugin.json",
  "src/editor/index.html": "editor/index.html",
  "src/editor/board.html": "editor/board.html",
  "media/icon.png": "assets/icon.png",
  images: "images",
  LICENSE: "LICENSE",
  "THIRD_PARTY_LICENSES.txt": "THIRD_PARTY_LICENSES.txt",
}

export function pluginBuilds(out) {
  return {
    worker: {
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
    },
    webview: {
      ...webviewBuildOptions({ production: false, outdir: `${out}editor` }),
      ...readable,
      metafile: false,
    },
    bridge: {
      ...readable,
      entryPoints: [`${here}editor/bridge.ts`],
      outfile: `${out}editor/bridge.js`,
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
    },
    panel: {
      ...readable,
      entryPoints: [`${here}panel/engines.tsx`],
      outfile: `${out}panel/engines.js`,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      external: ["orca", "orca/*"],
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "orca" } },
    },
  }
}

async function buildPlugin() {
  const out = `${app}dist/`
  await rm(out, { recursive: true, force: true })
  await mkdir(`${out}assets`, { recursive: true })
  await Promise.all(Object.values(pluginBuilds(out)).map((options) => esbuild.build(options)))
  for (const [from, to] of Object.entries(PLUGIN_FILES)) {
    await cp(`${app}${from}`, `${out}${to}`, { recursive: true })
  }
  console.log(`[pulse-orca] built ${out}`)
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (invokedDirectly) await buildPlugin()
