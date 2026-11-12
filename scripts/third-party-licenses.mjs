/**
 * The licence list of an artifact, its THIRD_PARTY_LICENSES.txt: what the artifact holds of works
 * that are not Pulse's own, read from its bundler's module graph, each work with the licence and
 * notice files it ships. Every module maps onto where it comes from: a module under node_modules
 * belongs to the package whose directory holds it, a virtual module of the bundler to the package
 * that writes it (`Layout.virtual`), and a file of this repository to the artifact, the
 * repository or one of Pulse's own packages, which share the artifact's licence; a module that
 * carries the text of another work names that work in `Layout.embedded`. Anything else fails, and
 * so does a work without a licence file, so nothing reaches an artifact unlisted.
 *
 * Node built-ins only (the closed worlds of the editor hosts hold it to that), so each artifact's
 * generator and drift test reads it, whatever builds the artifact: the CLI
 * (apps/cli/scripts/licenses/, tsdown), @miragon/pulse-c7-client (its generated SDK), the server
 * image (Vite), Pulse for VS Code and Pulse for Orca (esbuild). The readers of the module graphs
 * are here too: `renderedModules` (rolldown, rollup, Vite), `esbuildModules` (an esbuild
 * metafile) and `cssDependencies` (what Vite inlines into a stylesheet).
 * scripts/third-party-licenses.d.mts types it, scripts/third-party-licenses.test.mjs holds it to
 * planted cases.
 */
/**
 * Its declarations, which the TypeScript of the artifacts reads: knip resolves their imports of
 * this module to it, never to the declaration file, and sees them used through this namespace;
 * scripts/third-party-licenses.test.mjs holds the declarations to the module's exports.
 * @import * as Declarations from "./third-party-licenses.d.mts"
 * @import { Inventory, Layout, LicenceFiles, LicenceFileText, OpenApiSource } from "./third-party-licenses.d.mts"
 * @import { LicenceText, RenderedChunk, ThirdParty, Work } from "./third-party-licenses.d.mts"
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/** The file name every artifact ships its list under. */
export const LICENCES_FILE_NAME = "THIRD_PARTY_LICENSES.txt"

/** The files a work ships its licence and notices in; code of such a name (`license.js`) is none. */
const LICENCE_FILE =
  /^(?:licen[cs]es?|copying|notices?|third[-_]party[-_](?:licen[cs]es?|notices?))(?:[.-].*)?$/i
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json|map)$/i
const NODE_MODULES = `${sep}node_modules${sep}`

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

function field(manifest, key, dir) {
  const value = manifest[key]
  if (typeof value !== "string" || value === "") {
    throw new Error(`${join(dir, "package.json")} names no ${key}: the licence list needs it`)
  }
  return value
}

/** The repository URL a manifest names, without git's decorations. */
function sourceOf(manifest) {
  const { repository, homepage } = manifest
  const url = typeof repository === "string" ? repository : (repository?.url ?? homepage)
  return typeof url === "string" ? url.replace(/^git\+/, "").replace(/\.git$/, "") : undefined
}

/** A text as the list holds it: LF line ends, no trailing blanks, no blank lines around it. */
export const normalized = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "")

/**
 * The licence and notice files of a work's directory; a work without one fails, and so does one
 * that keeps them in a folder (REUSE's `LICENSES/`), which the list does not read.
 * @param {string} dir
 * @param {string} work
 * @returns {LicenceText[]}
 */
export function licenceTexts(dir, work) {
  const files = readdirSync(dir)
    .filter((file) => LICENCE_FILE.test(file) && !CODE_FILE.test(file))
    .sort()
  const folders = files.filter((file) => statSync(join(dir, file)).isDirectory())
  if (folders.length > 0) {
    throw new Error(
      `${work} (${dir}) keeps licence texts in the folder ${folders.join(", ")}: read them, and ` +
        "teach scripts/third-party-licenses.mjs to list them",
    )
  }
  if (files.length === 0) {
    throw new Error(
      `${work} (${dir}) ships no licence file (LICENSE, LICENCE, COPYING, NOTICE): find its ` +
        "licence before it ships, and name the folder that keeps a copy in the layout's licenceFiles",
    )
  }
  return files.map((file) => ({ file, text: normalized(readFileSync(join(dir, file), "utf8")) }))
}

/** The directory of the package a path under node_modules lies in (the last node_modules). */
function packageDirOf(path, at) {
  const [first = "", second = ""] = path.slice(at + NODE_MODULES.length).split(sep)
  return join(path.slice(0, at + NODE_MODULES.length), first, first.startsWith("@") ? second : "")
}

const isWithin = (dir, path) => {
  const rel = relative(dir, path)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/** A file of the repository: the artifact's, the repository's or one of Pulse's own packages'. */
function ownOrigin(path, layout) {
  let dir = dirname(path)
  while (dir !== layout.repo && !existsSync(join(dir, "package.json"))) dir = dirname(dir)
  return dir === layout.repo || dir === layout.home
    ? { kind: "own" }
    : { kind: "own", packageDir: dir }
}

/** Where a module of a bundle's module graph comes from. */
export function originOf(id, layout) {
  if (id.startsWith("\0")) {
    const virtual = layout.virtual[id]
    if (virtual === undefined) {
      throw new Error(
        `the bundle holds the virtual module ${JSON.stringify(id)}: name the package that ` +
          "writes it in the virtual modules of the artifact's layout",
      )
    }
    return { kind: "third-party", dir: virtual.dir, holds: virtual.holds }
  }
  const path = realpathSync(id)
  const at = path.lastIndexOf(NODE_MODULES)
  if (at >= 0) return { kind: "third-party", dir: packageDirOf(path, at) }
  if (!isWithin(layout.repo, path)) {
    throw new Error(
      `the bundle holds ${path}, which lies neither in node_modules nor in the repository`,
    )
  }
  return ownOrigin(path, layout)
}

/**
 * The licence files of a package, or of the folder the layout names for a package that ships
 * none (its licence from its repository, say), with where they come from.
 * @param {string} dir
 * @param {string} work
 * @param {Layout} layout
 */
function packageTexts(dir, work, layout) {
  /** @type {LicenceFiles | undefined} */
  const copy = layout.licenceFiles?.[work.replace(" ", "@")]
  if (copy === undefined) return { texts: licenceTexts(dir, work), textsFrom: undefined }
  if (readdirSync(dir).some((file) => LICENCE_FILE.test(file) && !CODE_FILE.test(file))) {
    throw new Error(
      `${work} (${dir}) ships a licence file now: drop its copy from the layout's licenceFiles`,
    )
  }
  return { texts: licenceTexts(join(layout.repo, copy.dir), work), textsFrom: copy.from }
}

/** A package under node_modules, or the bundler behind a virtual module. */
function packageWork(dir, holds, layout) {
  const manifest = readManifest(dir)
  const name = field(manifest, "name", dir)
  const version = field(manifest, "version", dir)
  const { texts, textsFrom } = packageTexts(dir, `${name} ${version}`, layout)
  return {
    name,
    version,
    licence: field(manifest, "license", dir),
    source: sourceOf(manifest),
    holds,
    texts,
    ...(textsFrom === undefined ? {} : { textsFrom }),
  }
}

/**
 * A work whose text a module carries, named by its OpenAPI document: `info` names its title, its
 * version and its licence, which must be the one the source expects; its licence and notice
 * files sit beside the document.
 * @param {OpenApiSource} source
 * @returns {Work}
 */
export function openApiWork(source) {
  const { info } = JSON.parse(readFileSync(join(source.dir, source.spec), "utf8"))
  if (info.license?.name !== source.licenceName) {
    throw new Error(
      `${join(source.dir, source.spec)} names the licence ${JSON.stringify(info.license?.name)}, ` +
        `not ${source.licenceName}: check its licence files and the embedded source`,
    )
  }
  const work = `${info.title} ${info.version}`
  const { licence, holds } = source
  const texts = licenceTexts(source.dir, work)
  return { name: info.title, version: info.version, licence, source: source.source, holds, texts }
}

/** The name of one of Pulse's packages in a bundle, which must be under the artifact's licence. */
function ownPackage(dir, licence, artifact) {
  const manifest = readManifest(dir)
  const name = field(manifest, "name", dir)
  const theirs = field(manifest, "license", dir)
  if (theirs !== licence) {
    throw new Error(
      `${name} is under ${theirs}, not under ${licence} like ${artifact}: list it as a third party`,
    )
  }
  return name
}

/** A module's path in the repository, with forward slashes. */
export const repoPath = (id, layout) => relative(layout.repo, realpathSync(id)).split(sep).join("/")

/** The work a module carries the text of: an entry for its path, or for a folder that holds it. */
function embeddedOf(id, layout) {
  if (id.startsWith("\0")) return undefined
  const path = repoPath(id, layout)
  const key = Object.keys(layout.embedded).find((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  )
  return key === undefined ? undefined : layout.embedded[key]
}

/** The works and Pulse packages the modules come from, each work once per name and version. */
class Works {
  thirdParty = new Map()
  own = new Set()
  #read = new Map()
  #layout
  #licence
  #artifact

  constructor(layout, licence, artifact) {
    this.#layout = layout
    this.#licence = licence
    this.#artifact = artifact
  }

  #record(key, bundle, read) {
    const work = this.#read.get(key) ?? read()
    this.#read.set(key, work)
    const id = `${work.name} ${work.version}`
    const entry = this.thirdParty.get(id) ?? { work, bundles: new Set() }
    entry.bundles.add(bundle)
    this.thirdParty.set(id, entry)
  }

  addModule(id, bundle) {
    const origin = originOf(id, this.#layout)
    if (origin.kind === "third-party") {
      this.#record(origin.dir, bundle, () => packageWork(origin.dir, origin.holds, this.#layout))
    } else if (origin.packageDir !== undefined) {
      this.own.add(ownPackage(origin.packageDir, this.#licence, this.#artifact))
    }
    const embedded = embeddedOf(id, this.#layout)
    if (embedded !== undefined) this.#record(embedded, bundle, embedded)
  }
}

const byName = (a, b) => {
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()]
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * The inventory of an artifact's module graphs: the module ids of each of its bundles, as the
 * bundler names them, keyed by the bundle names `layout.bundles` lists.
 * @param {Readonly<Record<string, readonly string[]>>} modules
 * @param {Layout} layout
 * @returns {Inventory}
 */
export function inventoryOf(modules, layout) {
  const home = readManifest(layout.home)
  const artifact = field(home, "name", layout.home)
  const works = new Works(layout, field(home, "license", layout.home), artifact)
  for (const bundle of layout.bundles) {
    for (const id of modules[bundle] ?? []) works.addModule(id, bundle)
  }
  const thirdParty = [...works.thirdParty.values()]
    .map(({ work, bundles }) => ({
      ...work,
      bundles: layout.bundles.filter((b) => bundles.has(b)),
    }))
    .sort(byName)
  const installed = Object.entries(home.dependencies ?? {}).map(
    ([name, version]) => `${name} ${version}`,
  )
  return { thirdParty, own: [...works.own].toSorted(), installed: installed.toSorted() }
}

const RULE = "=".repeat(80)

const artifactsOf = (bundles, text) => {
  const artifacts = text.artifacts[bundles.join(" ")]
  if (artifacts === undefined) throw new Error(`no bundle holds it: ${JSON.stringify(bundles)}`)
  return artifacts
}

const section = (title, lines) =>
  lines.length === 0 ? [] : ["", title, "", ...lines.map((line) => `  ${line}`)]

/** One line per work: name and version, licence, the artifacts that hold it, in columns. */
function summary(works, text) {
  const titles = works.map(({ name, version }) => `${name} ${version}`)
  const width = Math.max(0, ...titles.map((title) => title.length))
  const licenceWidth = Math.max(0, ...works.map(({ licence }) => licence.length))
  return works.map((work, i) =>
    [
      (titles[i] ?? "").padEnd(width),
      work.licence.padEnd(licenceWidth),
      artifactsOf(work.bundles, text),
    ]
      .join("   ")
      .trimEnd(),
  )
}

/**
 * One work: its facts, then every licence and notice file in full.
 * @param {ThirdParty} work
 * @param {LicenceFileText} text
 */
function entry(work, text) {
  const facts = [
    `Licence: ${work.licence}`,
    `In: ${artifactsOf(work.bundles, text)}`,
    ...(work.holds === undefined ? [] : [`Holds: ${work.holds}`]),
    ...(work.source === undefined ? [] : [`Source: ${work.source}`]),
    ...(work.textsFrom === undefined ? [] : [`Licence files: ${work.textsFrom}`]),
  ]
  const texts = work.texts.flatMap(({ file, text: body }) => ["", `--- ${file} ---`, "", body])
  return ["", RULE, `${work.name} ${work.version}`, ...facts, ...texts]
}

/**
 * The text of an artifact's THIRD_PARTY_LICENSES.txt for its inventory.
 * @param {Inventory} inventory
 * @param {LicenceFileText} text
 */
export function renderLicences(inventory, text) {
  const lines = [
    ...text.intro,
    ...section(text.titles.works, summary(inventory.thirdParty, text)),
    ...section(text.titles.own, inventory.own),
    ...(text.titles.installed === undefined
      ? []
      : section(text.titles.installed, inventory.installed)),
    ...(text.notes.length === 0 ? [] : ["", ...text.notes]),
    ...inventory.thirdParty.flatMap((work) => entry(work, text)),
  ]
  return `${lines.join("\n")}\n`
}

/** The works a THIRD_PARTY_LICENSES.txt lists: the name on the line after each rule. */
export function listedWorks(text) {
  const lines = text.split("\n")
  return lines.flatMap((line, i) => {
    const title = lines[i + 1]
    if (line !== RULE || title === undefined) return []
    const space = title.lastIndexOf(" ")
    return [space > 0 ? title.slice(0, space) : title]
  })
}

/**
 * What a THIRD_PARTY_LICENSES.txt misses against the inventory: a work a bundle holds that it
 * does not list, a work it lists that no bundle holds any more, else any other difference (a
 * version, a licence text); empty when it is the file the inventory renders.
 */
export function licenceFindings(current, inventory, text) {
  if (current === renderLicences(inventory, text)) return []
  const listed = new Set(listedWorks(current))
  const names = new Set(inventory.thirdParty.map(({ name }) => name))
  const findings = [
    ...inventory.thirdParty
      .filter(({ name }) => !listed.has(name))
      .map(
        (work) =>
          `${work.name} ${work.version} is in ${artifactsOf(work.bundles, text)}, but ` +
          `${LICENCES_FILE_NAME} does not list it`,
      ),
    ...[...listed]
      .filter((name) => !names.has(name))
      .map((name) => `${LICENCES_FILE_NAME} lists ${name}, which no bundle holds any more`),
  ]
  return (findings.length > 0 ? findings : [`${LICENCES_FILE_NAME} is out of date`]).map(
    (finding) => `${finding}: run \`${text.regenerate}\``,
  )
}

/** The strings of an OpenAPI document under `summary` and `description`, `min` characters or longer. */
export function openApiTexts(node, min) {
  if (Array.isArray(node)) return node.flatMap((item) => openApiTexts(item, min))
  if (node === null || typeof node !== "object") return []
  return Object.entries(node).flatMap(([key, value]) =>
    (key === "summary" || key === "description") && typeof value === "string"
      ? value.length >= min
        ? [value]
        : []
      : openApiTexts(value, min),
  )
}

/**
 * The modules of a rolldown, rollup or Vite output that hold code in it: each chunk's module ids
 * without the empty ones (a module tree-shaken away, a stylesheet extracted into an asset).
 */
export const renderedModules = (/** @type {readonly RenderedChunk[]} */ chunks) =>
  chunks.flatMap((chunk) =>
    chunk.type === "chunk"
      ? chunk.moduleIds.filter((id) => (chunk.modules[id]?.renderedLength ?? 0) > 0)
      : [],
  )

/** The virtual module of an esbuild bundle whose output declares esbuild's runtime helpers. */
export const ESBUILD_RUNTIME = "\0esbuild/runtime"

/** A helper of esbuild's runtime (internal/runtime/runtime.go): `var __toESM = (mod) => ...`. */
const ESBUILD_HELPER = /^[ \t]*var __[A-Za-z]\w* = /

/**
 * Whether an unminified output declares esbuild's runtime helpers: a `var __<name> = ` before the
 * comment that opens its first module (`// <the input's path>`, as its metafile names the input),
 * also indented inside an IIFE. Every helper of the runtime is named that way, so the list knows
 * none of them by name; a module's own `var __version` comes after its comment.
 */
function declaresRuntime(text, inputs) {
  const lines = text.split("\n")
  const first = lines.findIndex((line) => {
    const comment = /^[ \t]*\/\/ (.+)$/.exec(line)
    return comment !== null && Object.hasOwn(inputs, comment[1] ?? "")
  })
  return (first < 0 ? lines : lines.slice(0, first)).some((line) => ESBUILD_HELPER.test(line))
}

/**
 * The modules of an esbuild build that hold code or files in its outputs (the inputs of every
 * output, a stylesheet's and a copied font's included), as absolute paths from the build's
 * working directory, plus `ESBUILD_RUNTIME` when an output declares esbuild's runtime helpers.
 * Build without minifying, so the helpers keep their names and the modules their comments; a
 * module of another namespace than the file system becomes a virtual module, which the layout
 * must name.
 */
export function esbuildModules(result, workingDir) {
  const outputs = Object.entries(result.metafile.outputs)
  const ids = outputs.flatMap(([, output]) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([path]) => (/^[\w-]+:/.test(path) ? `\0${path}` : resolve(workingDir, path))),
  )
  const runtime = (result.outputFiles ?? []).some(({ path, text }) => {
    if (!/\.[cm]?js$/.test(path)) return false
    const output = outputs.find(([key]) => resolve(workingDir, key) === path)
    return declaresRuntime(text, output?.[1].inputs ?? {})
  })
  return runtime ? [ESBUILD_RUNTIME, ...ids] : ids
}

/** A hook of a Vite plugin, a function or an object with its handler, with `this` wrapped. */
function wrapHook(hook, wrapContext) {
  const handler = typeof hook === "function" ? hook : hook.handler
  if (typeof handler !== "function") return hook
  function wrapped(...args) {
    return handler.apply(wrapContext(this), args)
  }
  return typeof hook === "function" ? wrapped : { ...hook, handler: wrapped }
}

/** A stylesheet the bundler hands to its CSS pipeline, by its module id without a query. */
const STYLESHEET = /\.(?:css|pcss|postcss|sss|scss|sass|less|styl|stylus)$/

/** The specifier of each `@import` of a stylesheet, a `url()` one included. */
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))/g

/** A specifier that names a URL, which stays a request of the stylesheet and is never bundled. */
const isUrl = (specifier) => /^(?:[a-z][\w+.-]*:|\/\/)/i.test(specifier)

/** The string targets of a package's `exports` for a subpath, under any condition. */
function exportTargets(exports, subpath) {
  const conditionsOnly =
    typeof exports === "string" ||
    Array.isArray(exports) ||
    !Object.keys(exports).some((key) => key.startsWith("."))
  const entry = conditionsOnly ? (subpath === "." ? exports : undefined) : exports[subpath]
  const leaves = (node) =>
    typeof node === "string"
      ? [node]
      : node !== null && typeof node === "object"
        ? Object.values(node).flatMap(leaves)
        : []
  return leaves(entry)
}

/** The package `name` as Node finds it from `dir`: in the nearest node_modules that holds it. */
function packageDirFrom(name, dir) {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    if (dirname(at) === at) return undefined
  }
}

/** The files an `@import` of the stylesheet `from` may name, as a CSS resolver reads it. */
function importTargets(specifier, from) {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const path = isAbsolute(specifier) ? specifier : join(dirname(from), specifier)
    return [path, `${path}.css`]
  }
  const segments = specifier.split("/")
  const length = specifier.startsWith("@") ? 2 : 1
  const dir = packageDirFrom(segments.slice(0, length).join("/"), dirname(from))
  if (dir === undefined) return []
  const subpath = segments.slice(length).join("/")
  const { exports, style } = readManifest(dir)
  const targets =
    exports !== undefined
      ? exportTargets(exports, subpath === "" ? "." : `./${subpath}`)
      : subpath === ""
        ? [style ?? "index.css"]
        : [subpath, `${subpath}.css`]
  return targets.map((target) => join(dir, target))
}

/**
 * The stylesheets a Vite build inlines into its CSS, which never render code in their chunk: a
 * Vite plugin that records every file the plugins' `load` and `transform` hooks name with
 * `this.addWatchFile` (Vite's CSS plugin and Tailwind's name each file an `@import` pulls in that
 * way, Tailwind also each source it scans for class names), and `files(chunks)`: the stylesheets
 * among the chunks' modules (one a module imports, a package's included) and every stylesheet
 * their `@import`s pull in, transitively, each resolved to a file the build read. A file the
 * build only scanned is none of them, and an `@import` that names no file the build read fails,
 * as do `@plugin` and `@config` (code Tailwind loads) and a stylesheet in another language than
 * CSS, which the list cannot read yet. Add the plugin to the build's config.
 */
export function cssDependencies() {
  const watched = new Set()
  const wrapContext = (context) =>
    new Proxy(context, {
      get(target, key) {
        if (key === "addWatchFile") {
          return (id) => {
            watched.add(id)
            target.addWatchFile(id)
          }
        }
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  const plugin = {
    name: "third-party-licenses:css-dependencies",
    configResolved(config) {
      for (const each of config.plugins) {
        for (const name of ["load", "transform"]) {
          if (each[name] !== undefined) each[name] = wrapHook(each[name], wrapContext)
        }
      }
    },
  }
  const files = (/** @type {readonly RenderedChunk[]} */ chunks) => {
    const read = new Set(
      [...watched].filter((id) => isAbsolute(id) && existsSync(id)).map((id) => realpathSync(id)),
    )
    const queue = chunks
      .flatMap((chunk) => (chunk.type === "chunk" ? (chunk.moduleIds ?? []) : []))
      .map((id) => id.replace(/[?#].*$/, ""))
      .filter((id) => !id.startsWith("\0") && STYLESHEET.test(id))
      .map((id) => realpathSync(id))
    const sheets = new Set()
    for (let sheet = queue.shift(); sheet !== undefined; sheet = queue.shift()) {
      if (sheets.has(sheet)) continue
      sheets.add(sheet)
      if (!sheet.endsWith(".css")) {
        throw new Error(`${sheet} is no CSS: teach scripts/third-party-licenses.mjs to read it`)
      }
      const text = readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
      if (/@(?:plugin|config)\b/.test(text)) {
        throw new Error(
          `${sheet} loads code into Tailwind (@plugin, @config): teach ` +
            "scripts/third-party-licenses.mjs to list what it adds",
        )
      }
      for (const [, ...quoted] of text.matchAll(CSS_IMPORT)) {
        const specifier = quoted.find((each) => each !== undefined) ?? ""
        if (!isAbsolute(specifier) && isUrl(specifier)) continue
        const found = importTargets(specifier, sheet)
          .filter((path) => existsSync(path))
          .map((path) => realpathSync(path))
          .filter((path) => read.has(path))
        if (found.length === 0) {
          throw new Error(
            `${sheet} imports ${JSON.stringify(specifier)}, which names no stylesheet the build ` +
              "read: teach scripts/third-party-licenses.mjs to resolve it",
          )
        }
        queue.push(...found)
      }
    }
    return [...sheets].sort()
  }
  return { plugin, files }
}
