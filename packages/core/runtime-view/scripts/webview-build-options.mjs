import { fileURLToPath } from "node:url"
import { TailwindEntries } from "./tailwind-entries.mjs"

const here = fileURLToPath(new URL("../", import.meta.url))
const TAILWIND_ENTRIES = [`${here}src/webview/styles/webview.css`]

export function webviewBuildOptions({ production, outdir }) {
  return {
    entryPoints: { webview: `${here}src/webview/main.tsx` },
    outdir,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
    plugins: [new TailwindEntries({ entries: TAILWIND_ENTRIES, production })],
    sourcemap: !production,
    minify: production,
    metafile: true,
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".bpmn": "text" },
    assetNames: "fonts/[name]-[hash]",
    logLevel: "info",
  }
}
