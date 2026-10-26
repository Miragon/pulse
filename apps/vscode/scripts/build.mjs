import { writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { webviewBuildOptions } from "./webview-build-options.mjs"

const here = fileURLToPath(new URL("../", import.meta.url))
const dist = `${here}dist`
const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")
const require = createRequire(import.meta.url)

export function hostBuildOptions({ production: minify }) {
  return {
    entryPoints: [`${here}src/host/extension.ts`],
    outfile: `${dist}/extension.cjs`,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["vscode"],
    mainFields: ["module", "main"],
    loader: { ".bpmn": "text" },
    sourcemap: !minify,
    minify,
    metafile: true,
    logLevel: "info",
  }
}

export function engineCliBuildOptions({ outfile }) {
  return {
    entryPoints: [require.resolve("@miragon/operate/dist/operate.js")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "info",
  }
}

async function writeMetafiles(results) {
  const [host, webview] = results
  await writeFile(`${dist}/host.meta.json`, JSON.stringify(host.metafile))
  await writeFile(`${dist}/webview.meta.json`, JSON.stringify(webview.metafile))
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  await esbuild.build(engineCliBuildOptions({ outfile: `${dist}/engine-cli.js` }))
  const builds = [
    hostBuildOptions({ production }),
    webviewBuildOptions({ production, outdir: dist }),
  ]
  if (watch) {
    const contexts = await Promise.all(builds.map((options) => esbuild.context(options)))
    await Promise.all(contexts.map((context) => context.watch()))
  } else {
    await writeMetafiles(await Promise.all(builds.map((options) => esbuild.build(options))))
  }
}
