/**
 * The browser bundle of @miragon/pulse-widget-shell, for a page without a build (a Claude
 * artifact, a page of its own that loads its modules from a CDN): `pnpm build` writes it into
 * dist/browser/ after tsc, and the npm package ships it.
 *
 * - claude-artifact.js: ONE ES module with every name of the page reads (src/ui/page-reads, part of
 *   `./widgets`) and of the Claude artifact's entry (`./claude-artifact`), with TanStack Query and
 *   the part of the view runtime `mountApp` mounts. It holds no React and no kit: React, ReactDOM,
 *   the JSX runtime and @miragon/pulse-ui come from pulse-ui's browser bundle of the same version,
 *   by its one import `../../../pulse-ui@<version>/dist/browser/pulse-ui.js`. On a CDN that serves
 *   npm packages by name and version (jsDelivr's and unpkg's `/npm/@miragon/<name>@<version>/…`)
 *   that lands beside this package, so the page and this module run on one React and one copy of
 *   the kit's contexts (locale, toasts, `SectionStateGroup`). The version is pulse-ui's installed
 *   one, which must be this package's (one release train). Each module the import stands for
 *   names its own names of pulse-ui.js, so a name pulse-ui.js lacks fails the build ("No
 *   matching export"), never a page.
 *
 *   node scripts/browser-bundle.mjs [outdir]    (default dist/browser)
 *
 * test/browser-bundle.test.ts builds it and holds its names, its import and its size;
 * test/browser-page.test.ts renders a page over it in Chromium, the README's example included.
 *
 * Its declarations, which the suites' TypeScript reads:
 * @import * as Declarations from "./browser-bundle.d.mts"
 */
import { existsSync, readFileSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

/** The package's folder. */
export const PACKAGE = fileURLToPath(new URL("../", import.meta.url))

/** The file the build writes. */
export const BUNDLE = "claude-artifact.js"

/**
 * The modules the bundle exports every name of: the page reads (not the rest of `./widgets`, and
 * not src/ui/recording.ts, which a page replays only in its dev build), then the Claude artifact's
 * entry.
 */
export const ENTRIES = ["./src/ui/page-reads/index.ts", "./src/ui/claude-artifact/index.ts"]

/**
 * The modules pulse-ui.js provides, React's first: `React` and `ReactDOM` are the two default
 * exports, and the kit (@miragon/pulse-ui) is every name pulse-ui.js exports that is not React's.
 */
export const SHARED_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@miragon/pulse-ui",
]
const KIT = "@miragon/pulse-ui"
const DEFAULT_EXPORTS = { react: "React", "react-dom": "ReactDOM" }

/** The namespace of the modules that stand for pulse-ui.js (the licence list reads them as glue). */
export const SHARED_NAMESPACE = "widget-shell-shared"

/** pulse-ui's browser bundle the module imports React and the kit from. */
export const RUNTIME = "pulse-ui.js"

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

/** Node's resolution from this package, as its own modules resolve their imports. */
const requireHere = createRequire(join(PACKAGE, "package.json"))

/**
 * pulse-ui's installed package (through the stylesheet it exports, as its root exports no
 * package.json): its browser bundle's folder, its version and the import the bundle names it by.
 * Fails unless its version is this package's: the module and pulse-ui.js are loaded by the same
 * number.
 */
export function pulseUiRuntime() {
  const theme = requireHere.resolve("@miragon/pulse-ui/theme.css")
  let dir = dirname(theme)
  while (!existsSync(join(dir, "package.json"))) {
    if (dir === dirname(dir)) throw new Error(`no package.json holds ${theme}`)
    dir = dirname(dir)
  }
  const { version } = readManifest(dir)
  const own = readManifest(PACKAGE).version
  if (version !== own) {
    throw new Error(
      `@miragon/pulse-ui ${String(version)} is installed beside @miragon/pulse-widget-shell ` +
        `${String(own)}: ${BUNDLE} imports pulse-ui.js by its own version, so both must be the same`,
    )
  }
  return {
    dir: join(dir, "dist", "browser"),
    version,
    specifier: `../../../pulse-ui@${version}/dist/browser/${RUNTIME}`,
  }
}

/** The names pulse-ui.js exports, as esbuild reads its built file. */
async function runtimeNames(dir) {
  const result = await build({
    entryPoints: [join(dir, RUNTIME)],
    bundle: false,
    write: false,
    metafile: true,
    format: "esm",
    outfile: RUNTIME,
    logLevel: "silent",
  })
  return Object.values(result.metafile.outputs).flatMap((output) => output.exports)
}

/**
 * The names each shared module takes from pulse-ui.js: React's modules their public names
 * pulse-ui.js exports (React's production build is in it, so a name only the development build
 * exports, `act`, is none), the kit every other name but `React` and `ReactDOM`. Each module names
 * its own, so the bundle imports a name from pulse-ui.js once.
 */
function sharedNames(exports) {
  const offered = new Set(exports)
  const names = {}
  const react = new Set(Object.values(DEFAULT_EXPORTS))
  for (const id of SHARED_MODULES.filter((each) => each !== KIT)) {
    names[id] = Object.keys(requireHere(id)).filter((name) => offered.has(name))
    for (const name of names[id]) react.add(name)
  }
  names[KIT] = exports.filter((name) => !react.has(name))
  return names
}

/**
 * The plugin that makes React, ReactDOM, the JSX runtime and the kit pulse-ui.js's: each becomes a
 * module that re-exports its names of pulse-ui.js from the import beside this package, which stays
 * external.
 */
function sharePulseUi(runtime, names) {
  const shared = new RegExp(
    `^(?:${SHARED_MODULES.map((id) => id.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")).join("|")})$`,
  )
  return {
    name: "widget-shell:share-pulse-ui",
    setup(b) {
      b.onResolve({ filter: shared }, ({ path }) => ({ path, namespace: SHARED_NAMESPACE }))
      b.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/pulse-ui@/ }, ({ path }) =>
        path === runtime.specifier ? { path, external: true } : undefined,
      )
      b.onLoad({ filter: /.*/, namespace: SHARED_NAMESPACE }, ({ path }) => {
        const as = DEFAULT_EXPORTS[path]
        const list = [...(as === undefined ? [] : [`${as} as default`]), ...(names[path] ?? [])]
        return {
          contents: `export { ${list.join(", ")} } from ${JSON.stringify(runtime.specifier)}\n`,
          loader: "js",
        }
      })
    },
  }
}

/**
 * Builds the bundle: `files` maps its file name to its text, `result` is esbuild's result (its
 * metafile, which the licence list and the suites read) and `runtime` the pulse-ui it imports.
 * `minify: false` keeps the modules' comments for the licence list; `entries` replaces ENTRIES (a
 * suite plants a module there).
 * @param {{ minify?: boolean, entries?: readonly string[] }} [options]
 */
export async function buildBrowserBundle({ minify = true, entries = ENTRIES } = {}) {
  const runtime = pulseUiRuntime()
  const result = await build({
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
    stdin: {
      contents: entries.map((entry) => `export * from ${JSON.stringify(entry)}\n`).join(""),
      resolveDir: PACKAGE,
      sourcefile: BUNDLE,
      loader: "js",
    },
    outfile: BUNDLE,
    plugins: [sharePulseUi(runtime, sharedNames(await runtimeNames(runtime.dir)))],
  })
  const [output] = result.outputFiles
  if (output === undefined) throw new Error(`the build wrote no ${BUNDLE}`)
  return { files: { [BUNDLE]: output.text }, result, runtime }
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
