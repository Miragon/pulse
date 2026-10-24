import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { webviewBuildOptions } from "../../scripts/webview-build-options.mjs"

const devDir = fileURLToPath(new URL(".", import.meta.url))
const outdir = `${devDir}dist`
const buildOnly = process.argv.includes("--build")
const port = Number(process.env.PORT ?? 5174)

const stubOptions = {
  entryPoints: { stub: `${devDir}stub.ts` },
  outdir,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  loader: { ".bpmn": "text" },
  logLevel: "info",
}

const webviewOptions = { ...webviewBuildOptions({ production: true, outdir }), metafile: false }

if (buildOnly) {
  await Promise.all([esbuild.build(stubOptions), esbuild.build(webviewOptions)])
} else {
  const stub = await esbuild.context(stubOptions)
  const webview = await esbuild.context(webviewOptions)
  await Promise.all([stub.watch(), webview.watch()])
  const { hosts } = await webview.serve({ servedir: devDir, port })
  console.log(
    `Pulse webview dev page: http://${hosts[0] ?? "localhost"}:${port}/?fixture=definition&theme=light`,
  )
}
