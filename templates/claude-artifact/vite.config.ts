import { readFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * The artifact's three files: `pnpm build` writes dist/index.html (the page content a Claude
 * artifact wraps in its own skeleton: no <html>, <head> or <body>), dist/app.js and dist/app.css,
 * with fixed names. app.js is ONE classic script (an IIFE, no import or export), loaded by a plain
 * `<script src="app.js">` after the root: a module script from the artifact's own files may fail
 * in the artifact's sandboxed frame, whose origin is null, under CORS. `vite build --mode
 * fixtures` builds the same page on the fixtures into shots/dist for `pnpm shot`; `pnpm dev`
 * serves it on the fixtures as a module, as Vite's dev server does.
 */

const PAGE = new URL("./src/page.html", import.meta.url)
const THEME_BRIDGE = new URL("./src/temporary/theme-bridge.js", import.meta.url)

/** The page's content: src/page.html with the theme bridge inlined before the root. */
export function pageContent(): string {
  const bridge = readFileSync(THEME_BRIDGE, "utf8").trim()
  return readFileSync(PAGE, "utf8").replace(
    "<!-- theme-bridge -->",
    `<script>\n${bridge}\n</script>`,
  )
}

/** The dev page: the page's content in index.html's skeleton, on the fixtures. */
function devPage(html: string): string {
  const page = pageContent()
    .replace(/<link rel="stylesheet" href="app\.css" \/>\n/, "")
    .replace('<script src="app.js">', '<script type="module" src="/fixtures/dev.tsx">')
  return html.replace("<!-- artifact-page -->", page)
}

function artifactPage(): Plugin {
  return {
    name: "artifact-page",
    transformIndexHtml: { order: "pre", handler: devPage },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "index.html", source: pageContent() })
    },
  }
}

export default defineConfig(({ mode }) => {
  const fixtures = mode === "fixtures"
  return {
    plugins: [react(), tailwindcss(), artifactPage()],
    publicDir: false,
    build: {
      outDir: fixtures ? "shots/dist" : "dist",
      emptyOutDir: true,
      cssCodeSplit: false,
      modulePreload: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2048,
      rolldownOptions: {
        input: fixtures ? "fixtures/dev.tsx" : "src/artifact.tsx",
        output: {
          format: "iife",
          entryFileNames: "app.js",
          assetFileNames: "app[extname]",
          codeSplitting: false,
        },
      },
    },
  }
})
