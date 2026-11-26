/**
 * The browser bundle of @miragon/pulse-ui, for a page without a build (a Claude artifact, a page
 * of its own): `pnpm build` writes it into dist/browser/ after tsc, and the npm package ships it.
 *
 * - pulse-ui.js: ONE ES module with React, ReactDOM and the kit: the root entry's names
 *   (`export *`, so whatever the root exports lands here too), React's and ReactDOM's public names
 *   (hooks, `createElement`, `Fragment`, `createRoot`, `createPortal`, …, without their internals),
 *   the JSX runtime's `jsx` and `jsxs`, and `React` and `ReactDOM` themselves. React is in it once.
 * - pulse-ui.css: the stylesheet scripts/browser-bundle.css compiles: Tailwind's base, the theme,
 *   every class the kit renders and a set of layout utilities.
 * - pulse-ui-css.js: an ES module whose import puts that same text into the page, for a page
 *   that cannot link a stylesheet of its own (`stylesheetModule` below).
 * - Every entry of BROWSER_ENTRIES beside them: a module that imports React, ReactDOM and every
 *   module of the kit pulse-ui.js holds from ./pulse-ui.js (one React, one locale and toast
 *   context) and bundles the rest. lucide.js is every Lucide icon, named as lucide-react names it.
 *
 *   node scripts/browser-bundle.mjs [outdir]    (default dist/browser)
 *
 * src/browser-bundle.test.ts builds it and holds its names, its size and its page.
 *
 * Its declarations, which the suites' TypeScript reads:
 * @import * as Declarations from "./browser-bundle.d.mts"
 */
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { compile, optimize } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"
import { build } from "esbuild"

/** The package's folder. */
export const PACKAGE = fileURLToPath(new URL("../", import.meta.url))
const SRC = join(PACKAGE, "src")

/** The module every other entry imports React and the kit from, and the stylesheet. */
export const RUNTIME = "pulse-ui.js"
export const STYLESHEET = "pulse-ui.css"
const STYLESHEET_ENTRY = fileURLToPath(import.meta.resolve("./browser-bundle.css"))
/** The module that puts the stylesheet into the page. */
export const STYLESHEET_MODULE = "pulse-ui-css.js"
/** The attribute that marks its `<style>`; its value is the package's version. */
export const STYLESHEET_MARK = "data-pulse-ui"

/**
 * The entries beside pulse-ui.js: the file each writes, and the module it bundles (a package's
 * name, or a path in this package from `./`, as `"pulse-ui-bpmn.js": "./src/bpmn/index.ts"`).
 * Adding one is one line here, a line in the bundle budget and its name in the licence list's
 * bundles; it imports React, ReactDOM and the kit's modules pulse-ui.js holds from it.
 */
export const BROWSER_ENTRIES = {
  "lucide.js": "lucide-react",
  "pulse-ui-bpmn.js": "./src/bpmn/index.ts",
}

/**
 * The modules pulse-ui.js shares with every other entry, each by its public names; `React` and
 * `ReactDOM` are the two default exports.
 */
export const SHARED_MODULES = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"]
const DEFAULT_EXPORTS = { react: "React", "react-dom": "ReactDOM" }

/** A module's internals (`__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`). */
const isInternal = (name) => name.startsWith("__")

/**
 * The public names of each shared module, as its production build exports them (the bundle's
 * React is the production build), each name once: one a later module shares with an earlier one
 * (`version`, `Fragment`) must be the same value there, so pulse-ui.js exports it once.
 * @returns {Record<string, string[]>}
 */
export function sharedNames() {
  const script = `
    const out = {}, seen = new Map()
    for (const id of ${JSON.stringify(SHARED_MODULES)}) {
      const mod = require(id)
      out[id] = Object.keys(mod).filter((n) => n !== "default" && !n.startsWith("__")).sort()
      for (const name of out[id]) {
        if (seen.has(name) && !Object.is(seen.get(name), mod[name])) throw new Error(id + " exports another " + name)
        seen.set(name, mod[name])
      }
    }
    process.stdout.write(JSON.stringify(out))`
  const env = { ...process.env, NODE_ENV: "production" }
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { cwd: PACKAGE, env }))
}

/** The source of pulse-ui.js: the root entry, then each shared module's names not yet named. */
function runtimeSource(names) {
  const named = new Set()
  const lines = [`export * from ${JSON.stringify(join(SRC, "index.ts"))}`]
  for (const id of SHARED_MODULES) {
    const fresh = names[id].filter((name) => !named.has(name) && !isInternal(name))
    for (const name of fresh) named.add(name)
    const as = DEFAULT_EXPORTS[id]
    if (as !== undefined) lines.push(`export { default as ${as} } from ${JSON.stringify(id)}`)
    if (fresh.length > 0) lines.push(`export { ${fresh.join(", ")} } from ${JSON.stringify(id)}`)
  }
  return `${lines.join("\n")}\n`
}

/** What every entry is built with: one browser ES module, React's production build. */
const common = (minify) => ({
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  charset: "utf8",
  minify,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  absWorkingDir: PACKAGE,
  logLevel: "silent",
})

/** Whether `path` lies in `dir`. */
const isWithin = (dir, path) => !relative(dir, path).startsWith("..")

/** Marks the plugin's own call of esbuild's resolver. */
const OWN = Symbol("pulse-ui:own-resolve")

/**
 * The plugin of a later entry: a shared module, and a module of the kit that pulse-ui.js holds,
 * become a module that re-exports pulse-ui.js's names from ./pulse-ui.js, so the entry bundles no
 * second React and no second copy of a kit module (its contexts). A name pulse-ui.js lacks fails
 * the build ("No matching export").
 */
function shareRuntime(runtime) {
  const exports = runtime.exports
  const held = new Set(runtime.inputs.map((input) => resolve(PACKAGE, input)))
  const shim = (names, as) =>
    `export { ${[...(as === undefined ? [] : [`${as} as default`]), ...names].join(", ")} } from "./${RUNTIME}"\n`
  return {
    name: "pulse-ui:share-runtime",
    setup(b) {
      const shared = new RegExp(
        `^(?:${SHARED_MODULES.map((id) => id.replace("/", "\\/")).join("|")})$`,
      )
      b.onResolve({ filter: shared }, ({ path }) => ({ path, namespace: "pulse-ui-shared" }))
      b.onResolve({ filter: new RegExp(`^\\./${RUNTIME.replace(".", "\\.")}$`) }, ({ path }) => ({
        path,
        external: true,
      }))
      b.onResolve({ filter: /^\./ }, async ({ path, importer, resolveDir, kind, pluginData }) => {
        // The resolution below runs this hook again: that one resolves as esbuild does.
        if (pluginData === OWN || kind === "entry-point" || !isWithin(SRC, importer))
          return undefined
        const found = await b.resolve(path, { importer, resolveDir, kind, pluginData: OWN })
        if (found.errors.length > 0 || !held.has(found.path)) return undefined
        return { path: relative(PACKAGE, found.path), namespace: "pulse-ui-kit" }
      })
      b.onLoad({ filter: /.*/, namespace: "pulse-ui-shared" }, ({ path }) => ({
        contents: shim(
          exports.filter((name) => runtime.names[path]?.includes(name)),
          DEFAULT_EXPORTS[path],
        ),
        loader: "js",
      }))
      b.onLoad({ filter: /.*/, namespace: "pulse-ui-kit" }, () => ({
        contents: shim(exports.filter((name) => !isInternal(name))),
        loader: "js",
      }))
    },
  }
}

/** A Tailwind entry compiled as if it were scripts/browser-bundle.css, with the files it read. */
async function compiled(css, minify) {
  const dependencies = []
  const compiler = await compile(css, {
    base: dirname(STYLESHEET_ENTRY),
    onDependency: (path) => dependencies.push(path),
  })
  const built = compiler.build(new Scanner({ sources: compiler.sources }).scan())
  return { css: optimize(built, { file: STYLESHEET_ENTRY, minify }).code, dependencies }
}

/** The stylesheet compiled from `css`, a Tailwind entry read as scripts/browser-bundle.css. */
export async function compileStylesheet(css, { minify = true } = {}) {
  return (await compiled(css, minify)).css
}

/** The stylesheet, and what the licence list reads of it: the entry and the files it read. */
async function stylesheet(minify) {
  const { css, dependencies } = await compiled(await readFile(STYLESHEET_ENTRY, "utf8"), minify)
  return {
    css,
    plugin: {
      name: "pulse-ui:stylesheet",
      inlined: () => [{ entry: STYLESHEET_ENTRY, dependencies: [...new Set(dependencies)] }],
    },
  }
}

/**
 * pulse-ui-css.js: an ES module whose import puts `css`, the text of pulse-ui.css from the same
 * build, into the page as ONE `<style data-pulse-ui="<version>">` at the end of `<head>`. That is
 * where a `<link>` at the top of the page's content stands in a page a host wraps in a skeleton
 * of its own (a Claude artifact): after the skeleton's reset, so the kit's unlayered rules (the
 * roles, `color-scheme`, the body's font) win over it as they do from the linked file, and before
 * the page's own styles, so the kit declares its layer order first and the page's own rules win.
 * A `<style>` behaves as the linked file does, every at-rule in document order, `@property` (on
 * whose registrations Tailwind's utilities rest) and `@layer` included; whether a constructed
 * sheet (`adoptedStyleSheets`) registers `@property` is not established. An import of another
 * copy (another URL, another version) finds the mark and inserts nothing, and where there is no
 * document (Node) the import does nothing. It exports nothing.
 *
 * VERIFIED on 2026-11-26 by a probe artifact in a claude.ai chat (an artifact with no files of its
 * own, in the Claude desktop app):
 * 1. A stylesheet from a CDN is refused: the frame's content security policy names in `style-src`
 *    only the frame's own origin, 'unsafe-inline' and Google Fonts, so a `<link>` to jsDelivr's
 *    pulse-ui.css fails with a `style-src-elem` violation.
 * 2. A module script from jsDelivr loads (`script-src` names `https://cdn.jsdelivr.net/npm/`).
 * 3. A `<style>` a module script appends to `<head>` applies.
 * 4. `connect-src` names no CDN, so a module cannot fetch pulse-ui.css: the text is in the module.
 */
function stylesheetModule(css, version) {
  return `/*
 * @miragon/pulse-ui ${version}, dist/browser/${STYLESHEET_MODULE}: importing it puts the text of
 * dist/browser/${STYLESHEET} below into the page as one <style ${STYLESHEET_MARK}> at the end of
 * <head>, once per page, for a page that cannot link a stylesheet (a Claude artifact in a chat
 * loads none from a CDN).
 */
((css) => {
  const head = typeof document === "undefined" ? null : document.head
  if (!head || document.querySelector("style[${STYLESHEET_MARK}]")) return
  const style = document.createElement("style")
  style.setAttribute("${STYLESHEET_MARK}", ${JSON.stringify(version)})
  style.textContent = css
  head.append(style)
})(${JSON.stringify(css)})
`
}

/**
 * The files a build wrote, by their names: the script, and a stylesheet beside it when its
 * modules import CSS (`pulse-ui-bpmn.css` for diagram-js's, say).
 */
const outputsOf = (result) =>
  Object.fromEntries((result.outputFiles ?? []).map((file) => [basename(file.path), file.text]))

/** What the runtime's metafile says of pulse-ui.js: its names and the modules it holds. */
function runtimeOutput(result) {
  const [, meta] = Object.entries(result.metafile.outputs).find(([path]) => path === RUNTIME) ?? []
  if (meta === undefined) throw new Error(`the runtime's build wrote no ${RUNTIME}`)
  return { exports: meta.exports, inputs: Object.keys(meta.inputs) }
}

/**
 * Builds the bundle: `files` maps each file name to its text, `results` holds each entry's
 * esbuild result (its metafile) and `stylesheet` the Tailwind entry's dependencies, which the
 * licence list reads. `minify: false` keeps the modules' comments for it; `entries` replaces
 * BROWSER_ENTRIES (the suite builds a probe of the kit's modules beside them).
 * @param {{ minify?: boolean, entries?: Record<string, string> }} [options]
 */
export async function buildBrowserBundle({ minify = true, entries = BROWSER_ENTRIES } = {}) {
  const names = sharedNames()
  const runtimeResult = await build({
    ...common(minify),
    stdin: {
      contents: runtimeSource(names),
      resolveDir: PACKAGE,
      sourcefile: RUNTIME,
      loader: "js",
    },
    outfile: RUNTIME,
  })
  const runtime = { ...runtimeOutput(runtimeResult), names }
  const results = { [RUNTIME]: runtimeResult }
  let files = outputsOf(runtimeResult)
  for (const [file, entry] of Object.entries(entries)) {
    const result = await build({
      ...common(minify),
      entryPoints: [entry.startsWith(".") ? join(PACKAGE, entry) : entry],
      outfile: file,
      plugins: [shareRuntime(runtime)],
    })
    results[file] = result
    files = { ...files, ...outputsOf(result) }
  }
  const sheet = await stylesheet(minify)
  const { version } = JSON.parse(await readFile(join(PACKAGE, "package.json"), "utf8"))
  files[STYLESHEET] = sheet.css
  files[STYLESHEET_MODULE] = stylesheetModule(sheet.css, version)
  return { files, results, runtimeExports: runtime.exports, stylesheet: sheet.plugin }
}

/** Writes the bundle into `outdir`, which holds nothing else afterwards. */
export async function writeBrowserBundle(outdir) {
  const { files } = await buildBrowserBundle()
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })
  for (const [file, text] of Object.entries(files)) await writeFile(join(outdir, file), text)
  return Object.keys(files).map((file) => join(outdir, file))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = resolve(process.argv[2] ?? join(PACKAGE, "dist/browser"))
  const written = await writeBrowserBundle(outdir)
  for (const path of written)
    console.info(`wrote ${relative(process.cwd(), path).split(sep).join("/")}`)
}
