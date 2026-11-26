#!/usr/bin/env node
// @ts-check
/**
 * Pack-content gate: what a published tarball ships. scripts/test-template.sh packs every
 * library (pnpm pack, the same tarball the release publishes) and runs this over the tarballs:
 *
 * - no test ships: no `*.test.*` or `*.test-support.*` file and nothing under a `test-support/`
 *   directory, in dist/ or in the src/ every library ships (the sources its maps name; a
 *   connector's `./widgets` and the reference implementation the template's docs point at);
 * - no tsconfig ships: a src/ carries the editor's nested tsconfig.json of its widgets (a
 *   connector's, widget-shell's src/ui), and a host's Vite reads the nearest tsconfig.json of
 *   every source file it compiles outside node_modules (a linked or `file:` package), so it
 *   would fail on the `extends` target the tarball lacks;
 * - every `exports` target, `main` and `types` is in the tarball;
 * - every relative import of a shipped module (JS, TS, declarations) resolves inside the
 *   tarball, so a `files` list never leaves behind a module a widget imports (a host's Vite
 *   compiles `./widgets` from that source) or a declaration a declaration names. The one
 *   exception is a browser bundle's import of a sibling library on a CDN (CDN_SIBLING): it
 *   resolves inside the tarball of that library, packed in the same run at exactly the version
 *   it names;
 * - every source a shipped map names (`.js.map`, `.d.ts.map`) is inside the tarball or inlined
 *   as its `sourcesContent`: a host's Vite loads the map of every module it transforms and
 *   warns "points to missing source files" once per module otherwise, and an editor's
 *   go-to-definition follows a declaration map to its source.
 *
 * What a shipped module imports from OTHER packages is scripts/published-imports.test.mjs's.
 *
 *   node scripts/pack-contents.mjs <package.tgz>...
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/** A test or test support, by its name or its directory. */
export const TEST_FILE = /(?:^|\/)(?:test-support\/|[^/]+\.test(?:-support)?\.[^/]+$)/

/** A TypeScript project file (tsconfig.json, tsconfig.<x>.json), wherever it sits. */
export const TSCONFIG_FILE = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/

/** Modules whose relative imports must resolve: JS, TS and declarations, never maps. */
const MODULE = /\.(?:[cm]?[jt]sx?)$/

/** Every relative module specifier of `source` (TypeScript AST: comments and strings are none). */
export function relativeSpecifiers(file, source) {
  const specifiers = []
  const visit = (node) => {
    let spec
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      spec = node.moduleSpecifier
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      spec = node.arguments[0]
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      spec = node.argument.literal
    }
    if (spec !== undefined && ts.isStringLiteralLike(spec) && spec.text.startsWith(".")) {
      specifiers.push(spec.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
  return specifiers
}

const DECLARATION = /\.d\.[cm]?ts$/

/**
 * The files a relative specifier may name: as written, by its TS source, or as a directory. A
 * declaration's import needs a declaration: the JS beside it gives a consumer no types.
 */
function candidates(from, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  const stem = base.replace(/\.[cm]?jsx?$/, "")
  if (DECLARATION.test(from)) {
    return [".d.ts", ".d.mts", ".d.cts", "/index.d.ts"].map((ext) => `${stem}${ext}`)
  }
  const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
  return [
    base,
    ...extensions.map((ext) => `${stem}${ext}`),
    ...[".ts", ".tsx", ".js"].map((ext) => `${base}/index${ext}`),
  ]
}

/**
 * A browser bundle's import of a sibling library on a CDN that serves npm packages by name and
 * version (`/npm/@miragon/<name>@<version>/…` on jsDelivr and unpkg): from `dist/browser/<file>.js`
 * three levels up is the package's scope, so `../../../pulse-ui@0.32.0/dist/browser/pulse-ui.js`
 * names pulse-ui's browser bundle of that version (widget-shell's claude-artifact.js takes React
 * and the kit from it). Its groups: the library's name in the scope, the version, the file.
 */
export const CDN_SIBLING =
  /^\.\.\/\.\.\/\.\.\/(pulse-[a-z-]+)@(\d+\.\d+\.\d+)\/(dist\/browser\/[\w.-]+\.js)$/

/** A browser bundle's module: the only place a CDN-sibling import may stand. */
const BROWSER_BUNDLE = /^dist\/browser\/[^/]+\.js$/

/**
 * Why a CDN-sibling import of `file` fails, or undefined when the library is packed in the same
 * run (`siblings`: its name to its version and files) at exactly that version and holds the file.
 * The library's name is the package's scope plus the import's name.
 */
function siblingFinding(manifest, sibling, siblings) {
  const [, base, version, target] = sibling
  const scope = /^(@[^/]+)\//.exec(manifest.name ?? "")?.[1]
  const name = scope === undefined ? base : `${scope}/${base}`
  const packed = siblings.get(name)
  const beside = `${name}'s file beside it on a CDN`
  if (packed === undefined) return `${beside}, but this run packs no ${name}`
  if (packed.version !== version) {
    return `${beside} at ${version}, but this run packs ${name} ${packed.version}: a page loads both by one version`
  }
  if (!packed.files.has(target)) return `${beside}, which ${name}'s tarball lacks`
  return undefined
}

/** A source map, of a module or of a declaration. */
const SOURCE_MAP = /\.map$/

/** Where a tarball's root sits while a map source resolves: anything outside it is not inside. */
const PACKAGE_ROOT = "/package"

/**
 * The sources the map at `file` (its JSON `text`) names that the tarball lacks, unless the map
 * inlines their content; null when the text is no JSON object. A source resolves from the map's
 * directory through its `sourceRoot`, so one above the package root or an absolute path (the
 * build machine's) is never inside.
 */
function missingSources(file, text, shipped) {
  let map
  try {
    map = JSON.parse(text)
  } catch {
    return null
  }
  if (map === null || typeof map !== "object" || Array.isArray(map)) return null
  const root = typeof map.sourceRoot === "string" ? map.sourceRoot : ""
  const inside = (source) => {
    const resolved = path.posix.resolve(PACKAGE_ROOT, path.posix.dirname(file), root, source)
    return (
      resolved.startsWith(`${PACKAGE_ROOT}/`) &&
      shipped.has(resolved.slice(PACKAGE_ROOT.length + 1))
    )
  }
  return (Array.isArray(map.sources) ? map.sources : []).filter(
    (source, i) =>
      typeof source === "string" && typeof map.sourcesContent?.[i] !== "string" && !inside(source),
  )
}

/** Every string target of an `exports` value, whatever its conditions. */
function exportTargets(value, key = ".") {
  if (typeof value === "string") return [{ key, target: value }]
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([k, v]) => exportTargets(v, k.startsWith(".") ? k : key))
}

/**
 * The findings for one tarball: its `manifest`, its `files` (paths relative to the package
 * root), `read(file)` for a module's text and the `siblings` packed in the same run (each
 * library's name to its `version` and the Set of its `files`), which a CDN-sibling import
 * resolves in.
 */
export function packFindings({ manifest, files, read, siblings = new Map() }) {
  const shipped = new Set(files)
  const findings = []
  for (const file of files) {
    if (TEST_FILE.test(file)) findings.push(`${file}: a test ships (exclude it in files)`)
    if (TSCONFIG_FILE.test(file)) {
      findings.push(
        `${file}: a tsconfig ships (exclude it in files): a host's Vite reads it for the ` +
          `package's sources and fails on an extends target the tarball lacks`,
      )
    }
  }
  const entries = [
    ...exportTargets(manifest.exports ?? {}).map(({ key, target }) => [`exports ${key}`, target]),
    ...["main", "types"].filter((field) => manifest[field]).map((f) => [f, manifest[f]]),
  ]
  for (const [entry, target] of entries) {
    const file = path.posix.normalize(target)
    if (!shipped.has(file)) findings.push(`${entry}: ${target} is not in the tarball`)
  }
  for (const file of files) {
    if (!MODULE.test(file) || TEST_FILE.test(file)) continue
    for (const spec of new Set(relativeSpecifiers(file, read(file)))) {
      if (candidates(file, spec).some((candidate) => shipped.has(candidate))) continue
      const sibling = BROWSER_BUNDLE.test(file) ? CDN_SIBLING.exec(spec) : null
      if (sibling === null) {
        findings.push(`${file}: imports ${spec}, which the tarball lacks (add it to files)`)
        continue
      }
      const why = siblingFinding(manifest, sibling, siblings)
      if (why !== undefined) findings.push(`${file}: imports ${spec}, ${why}`)
    }
  }
  // One finding for every map a tarball lacks sources for: they share one fix, and a package
  // that dropped its src would otherwise list every module twice (.js.map, .d.ts.map).
  const unmapped = []
  for (const file of files) {
    if (!SOURCE_MAP.test(file) || TEST_FILE.test(file)) continue
    const missing = missingSources(file, read(file), shipped)
    if (missing === null) findings.push(`${file}: a map that is no JSON object ships`)
    else unmapped.push(...missing.map((source) => ({ file, source })))
  }
  if (unmapped.length > 0) {
    const [{ file, source }] = unmapped
    const more = unmapped.length > 1 ? ` (and ${unmapped.length - 1} more)` : ""
    findings.push(
      `${file}: points to ${source}, which the tarball lacks${more}: ship the sources (src in ` +
        `files; inlineSources fills a .js.map, never a .d.ts.map), else a host's Vite warns ` +
        `once per module it loads and go-to-definition stops at the declaration`,
    )
  }
  return findings
}

/** The files under `dir`, relative and with forward slashes. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort()

/**
 * What each tarball of a run packs, by its name: its version and the Set of its files, which a
 * CDN-sibling import of another tarball resolves in.
 */
export function packedSiblings(tarballs) {
  const packed = tarballs.map((tgz) => {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", tgz, "package/package.json"], { encoding: "utf8" }),
    )
    const files = execFileSync("tar", ["-tzf", tgz], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((entry) => entry.startsWith("package/") && !entry.endsWith("/"))
      .map((entry) => entry.slice("package/".length))
    return [manifest.name, { version: manifest.version, files: new Set(files) }]
  })
  return new Map(packed)
}

/**
 * The findings for the tarball at `tgz`, read the way npm unpacks it, beside the `siblings`
 * packed in the same run (packedSiblings).
 */
export function tarballFindings(tgz, siblings = new Map()) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pack-contents-"))
  try {
    execFileSync("tar", ["-xzf", tgz, "-C", dir])
    const root = path.join(dir, "package")
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    const files = filesUnder(root)
    const read = (file) => readFileSync(path.join(root, file), "utf8")
    return {
      name: manifest.name,
      files: files.length,
      findings: packFindings({ manifest, files, read, siblings }),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const tarballs = process.argv.slice(2)
  if (tarballs.length === 0) {
    console.error("usage: node scripts/pack-contents.mjs <package.tgz>...")
    process.exit(2)
  }
  let failed = false
  const siblings = packedSiblings(tarballs)
  for (const tgz of tarballs) {
    const { name, files, findings } = tarballFindings(tgz, siblings)
    if (findings.length === 0) {
      console.log(
        `pack-contents: ${name}: ${files} files, no test, every entry, import and map source inside`,
      )
      continue
    }
    failed = true
    console.error(`pack-contents: ${name} (${tgz}):`)
    for (const finding of findings) console.error(`  - ${finding}`)
  }
  if (failed) process.exit(1)
}
