import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * The artifact's three files: `pnpm build` writes dist/index.html (the page content a Claude
 * artifact wraps in its own skeleton: no <html>, <head> or <body>), dist/app.js and
 * dist/pulse-ui.css, with fixed names. app.js is ONE classic script (an IIFE, no import or
 * export), loaded by a plain `<script src="app.js">` after the root: a module script from the
 * artifact's own files may fail in the artifact's sandboxed frame, whose origin is null, under
 * CORS. pulse-ui.css is pulse-ui's stylesheet for a page without a build (its
 * dist/browser/pulse-ui.css) as it ships: the theme, following the root's data-theme and else the
 * OS, every class the kit renders and its documented layout utilities, which are the only classes
 * the page's own elements use (test/brand.test.ts holds them to it). `vite build --mode fixtures`
 * builds the same page on the fixtures into shots/dist for `pnpm shot`; `pnpm dev` serves it on
 * the fixtures as a module, as Vite's dev server does.
 */

const PAGE = new URL("./src/page.html", import.meta.url)

/**
 * pulse-ui's stylesheet for a page without a build, in the installed package (a direct dependency,
 * so its folder is node_modules/@miragon/pulse-ui beside this file).
 */
export const STYLESHEET = fileURLToPath(
  new URL("./node_modules/@miragon/pulse-ui/dist/browser/pulse-ui.css", import.meta.url),
)
const STYLESHEET_NAME = "pulse-ui.css"

/** The page's content: src/page.html as it is. */
export function pageContent(): string {
  return readFileSync(PAGE, "utf8")
}

/** The dev page: the page's content in index.html's skeleton, on the fixtures. */
function devPage(html: string): string {
  const page = pageContent().replace(
    '<script src="app.js">',
    '<script type="module" src="/fixtures/dev.tsx">',
  )
  return html.replace("<!-- artifact-page -->", page)
}

function artifactPage(): Plugin {
  return {
    name: "artifact-page",
    transformIndexHtml: { order: "pre", handler: devPage },
    configureServer(server) {
      server.middlewares.use(`/${STYLESHEET_NAME}`, (_request, response) => {
        response.setHeader("content-type", "text/css; charset=utf-8")
        response.end(readFileSync(STYLESHEET))
      })
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "index.html", source: pageContent() })
      this.emitFile({ type: "asset", fileName: STYLESHEET_NAME, source: readFileSync(STYLESHEET) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const fixtures = mode === "fixtures"
  return {
    plugins: [react(), artifactPage()],
    publicDir: false,
    build: {
      outDir: fixtures ? "shots/dist" : "dist",
      emptyOutDir: true,
      modulePreload: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2048,
      rolldownOptions: {
        input: fixtures ? "fixtures/dev.tsx" : "src/artifact.tsx",
        output: {
          format: "iife",
          entryFileNames: "app.js",
          codeSplitting: false,
        },
      },
    },
  }
})
