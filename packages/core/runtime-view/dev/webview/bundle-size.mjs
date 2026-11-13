import { gzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { webviewBuildOptions } from "../../scripts/webview-build-options.mjs"
const outdir = fileURLToPath(new URL("./dist/size", import.meta.url))
const result = await esbuild.build({
  ...webviewBuildOptions({ production: true, outdir }),
  logLevel: "silent",
})
const js = readFileSync(`${outdir}/webview.js`)
const css = readFileSync(`${outdir}/webview.css`)
console.log(
  `webview.js  ${(js.length / 1024).toFixed(1)} kB min, ${(gzipSync(js, { level: 9 }).length / 1024).toFixed(1)} kB gz`,
)
console.log(
  `webview.css ${(css.length / 1024).toFixed(1)} kB min, ${(gzipSync(css, { level: 9 }).length / 1024).toFixed(1)} kB gz`,
)
const output = Object.entries(result.metafile.outputs).find(([name]) =>
  name.endsWith("webview.js"),
)[1]
const groups = new Map()
for (const [path, { bytesInOutput }] of Object.entries(output.inputs)) {
  const match = path.match(/node_modules\/((@[^/]+\/)?[^/]+)/)
  const key = match ? match[1] : "src/webview"
  groups.set(key, (groups.get(key) ?? 0) + bytesInOutput)
}
for (const [key, bytes] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`${key.padEnd(34)} ${(bytes / 1024).toFixed(1)} kB min`)
}
