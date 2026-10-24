import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL("../", import.meta.url))

export function webviewBuildOptions({ production, outdir }) {
  return {
    entryPoints: { webview: `${here}src/webview/main.tsx` },
    outdir,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "preact",
    sourcemap: !production,
    minify: production,
    metafile: true,
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".bpmn": "text" },
    assetNames: "fonts/[name]-[hash]",
    logLevel: "info",
  }
}
