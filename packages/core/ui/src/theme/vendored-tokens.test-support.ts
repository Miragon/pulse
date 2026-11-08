/// <reference types="node" />
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

/**
 * The verifier behind the token drift guard (`token-drift.test.ts`;
 * modeler-tool-design §13: vendor the CI tokens unchanged, never fork a
 * value). A `--cd-*` token may be declared only in a vendored copy of a CI
 * file that a SANCTIONED manifest lists (pulse-ui's copy, the token file every
 * view ships, is one of them). The manifest has the docs kit's format (`version` x.y.z,
 * `dateien: [{ pfad, quelle, sha256 }]`, at least one file; extra keys such as
 * `$kommentar` are fine) and sanctions a stylesheet only when it lies inside
 * the manifest's own folder and matches its sha256 byte for byte. A manifest
 * sanctions nothing by being there: the caller names the manifests it trusts.
 * Token equality: a `--cd-*` that two sanctioned copies declare in the same
 * scope (a top-level `:root`, the light or the dark theme) has one value in
 * both, and in a top-level `:root` it is the palette's value, so a CI release
 * that changes a value reaches every copy in one re-vendor. Once any stylesheet
 * of a manifest declares a `--cd-*` at all, those stylesheets' top-level
 * `:root` blocks together declare EVERY token of the palette: a copy that drops
 * one forks the palette by omission.
 *
 * Every rule fails closed: a sanctioned manifest that is missing, malformed,
 * lists a path outside the repo, a missing or edited file, or sits next to a
 * file it does not list is a finding, never a skip.
 *
 * This module is a test helper inside pulse-ui's measured coverage scope:
 * `vendored-tokens.test.ts` reaches every branch. Keep it that way when you
 * change it.
 */

/** Installs and build output: never repo content (installed copies sit in node_modules). */
const SKIPPED = ["node_modules", "dist", "cache", ".vitepress-cache", "test-results"]

/**
 * VitePress's build directory, repo-relative: it exists only while the docs build runs, and turbo
 * runs that build beside this scan, which would read the bundled kit as a fork. Only this path:
 * a `.temp` folder anywhere else is scanned.
 */
const DOCS_BUILD_DIR = "docs/.vitepress/.temp"

const SHA256 = /^[0-9a-f]{64}$/
const VERSION = /^\d+\.\d+\.\d+$/
const CD_DECLARATION = /--cd-[\w-]+\s*:/

const SHAPE =
  "version x.y.z, dateien: [{ pfad, quelle, sha256 }] with at least one file, a non-empty pfad and quelle and a lowercase hex sha256"

interface VendoredFile {
  /** Repo-relative path of the copy. */
  pfad: string
  /** Where the file comes from in the CI repo. */
  quelle: string
  /** sha256 of the file as vendored, lowercase hex. */
  sha256: string
}

interface VendorManifest {
  version: string
  dateien: VendoredFile[]
}

export interface VendoredTokenOptions {
  /** Absolute repo root. */
  root: string
  /** The sanctioned manifests, repo-relative. Only a copy one of them lists may declare `--cd-*`. */
  manifests: readonly string[]
  /** Repo-relative folders whose `.css` files must not declare a `--cd-*` of their own. */
  scanRoots: readonly string[]
  /**
   * The top-level `:root` tokens of pulse-ui's copy (`rootTokens`): a sanctioned
   * copy keeps each value in its top-level `:root`, and a manifest whose copies
   * declare tokens declares all of them.
   */
  palette: ReadonlyMap<string, string>
}

/** Rules only: a comment may name what it forbids. */
const rulesOf = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "")

const posix = (path: string) => path.split(sep).join("/")

const sha256Of = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

const isFile = (file: string) => existsSync(file) && statSync(file).isFile()

function isVendoredFile(entry: unknown): entry is VendoredFile {
  const { pfad, quelle, sha256 } = (entry ?? {}) as Partial<VendoredFile>
  return (
    typeof pfad === "string" &&
    pfad !== "" &&
    typeof quelle === "string" &&
    quelle !== "" &&
    typeof sha256 === "string" &&
    SHA256.test(sha256)
  )
}

function isVendorManifest(data: unknown): data is VendorManifest {
  const { version, dateien } = (data ?? {}) as Partial<VendorManifest>
  return (
    typeof version === "string" &&
    VERSION.test(version) &&
    Array.isArray(dateien) &&
    dateien.length > 0 &&
    dateien.every(isVendoredFile)
  )
}

/** The parsed manifest, or the finding that says why it cannot be trusted. */
function readManifest(root: string, manifest: string): VendorManifest | string {
  let data: unknown
  try {
    data = JSON.parse(readFileSync(join(root, manifest), "utf8"))
  } catch (error) {
    return `${manifest}: missing or not JSON (${String(error)}): restore the manifest that came with the vendored copy, or remove the copy together with its entry in SANCTIONED_TOKEN_MANIFESTS`
  }
  return isVendorManifest(data)
    ? data
    : `${manifest}: not a vendor manifest (${SHAPE}): take the manifest the CI generated, or write one in the docs kit's format`
}

/** Every file under `dir`, recursively; `.DS_Store` is ignored, as the docs kit's check.mjs does. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name !== ".DS_Store")
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? filesUnder(path) : [path]
    })
}

/** Every `.css` file under `dir`, skipping installs and build output. */
function stylesheetsUnder(root: string, dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (SKIPPED.includes(name) || posix(relative(root, path)) === DOCS_BUILD_DIR) return []
    if (statSync(path).isDirectory()) return stylesheetsUnder(root, path)
    return name.endsWith(".css") ? [path] : []
  })
}

/**
 * The `--cd-*` tokens a stylesheet declares directly in a top-level `:root { }`
 * block, by name (a later declaration wins, as in CSS; whitespace in a value is
 * folded). Everything else is ignored: other selectors (`:root:not(…)`,
 * `:root .x`, `[data-cd-theme="dark"]`), anything inside an at-rule such as
 * `@media`, and the rules nested inside `:root`.
 */
export function rootTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>()
  const text = rulesOf(css)
  let depth = 0
  let selectorStart = 0
  let inRoot = false
  let own = ""
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "{") {
      if (depth === 0) {
        inRoot = text.slice(selectorStart, i).trim() === ":root"
        own = ""
      } else if (depth === 1) {
        // A nested rule ends the declaration before it; its body is skipped.
        own += ";"
      }
      depth++
    } else if (char === "}") {
      depth = Math.max(0, depth - 1)
      if (depth === 0) {
        selectorStart = i + 1
        if (inRoot) {
          for (const [, name, value] of own.matchAll(/(--cd-[\w-]+)\s*:\s*([^;]*)/g)) {
            tokens.set(name, value.replace(/\s+/g, " ").trim())
          }
        }
        inRoot = false
      }
    } else if (depth === 0 && char === ";") {
      // A statement such as `@charset "UTF-8";` or `@import …;` is no selector.
      selectorStart = i + 1
    } else if (depth === 1 && inRoot) {
      own += char
    }
  }
  return tokens
}

const fold = (text: string) => text.replace(/\s+/g, " ").trim()

/** A selector list split at its top-level commas: `:is(a, b)` and `[x="a,b"]` stay whole. */
function selectorsOf(prelude: string): string[] {
  const selectors: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i]
    if (char === "(" || char === "[") depth++
    else if (char === ")" || char === "]") depth--
    else if (char === "," && depth === 0) {
      selectors.push(prelude.slice(start, i))
      start = i + 1
    }
  }
  return [...selectors, prelude.slice(start)].map(fold)
}

/**
 * The `--cd-*` tokens a stylesheet declares, by scope: each selector of a rule's
 * list inside the at-rules around it, written as CSS (`:root`,
 * `@media screen { [data-cd-theme="dark"] }`), so `html.dark, [data-cd-theme="dark"]`
 * in one copy and `[data-cd-theme="dark"]` in another meet in one scope. A later
 * declaration wins, as in CSS; whitespace in a value is folded.
 */
export function scopedTokens(css: string): Map<string, Map<string, string>> {
  const scopes = new Map<string, Map<string, string>>()
  const text = rulesOf(css)
  const blocks: string[] = []
  let start = 0
  const declare = (end: number) => {
    const declaration = /^\s*(--cd-[\w-]+)\s*:([\s\S]*)$/.exec(text.slice(start, end))
    const rule = blocks.at(-1)
    if (declaration === null || rule === undefined) return
    const outer = blocks.slice(0, -1).map(fold)
    for (const selector of selectorsOf(rule)) {
      const scope = [...outer, selector].join(" { ") + " }".repeat(outer.length)
      const tokens = scopes.get(scope) ?? new Map<string, string>()
      tokens.set(declaration[1], fold(declaration[2]))
      scopes.set(scope, tokens)
    }
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "{") {
      blocks.push(text.slice(start, i))
    } else if (char === ";") {
      declare(i)
    } else if (char === "}") {
      declare(i)
      blocks.pop()
    } else continue
    start = i + 1
  }
  return scopes
}

/** What the manifests sanction: the copies inside their folders, by manifest. */
interface Sanction {
  /** Every sanctioned copy (absolute path). */
  files: Set<string>
  /** The copies each manifest sanctions. */
  byManifest: Map<string, string[]>
}

const isRepoRelative = (pfad: string) => !isAbsolute(pfad) && !pfad.split(/[\\/]/).includes("..")

/** The finding for a listed copy that is missing or edited, else none. */
function copyFinding(manifest: string, { pfad, sha256 }: VendoredFile, file: string) {
  if (!isFile(file)) {
    return `${pfad}: listed in ${manifest} but missing: re-vendor it from the CI, or regenerate the manifest`
  }
  return sha256Of(file) === sha256
    ? null
    : `${pfad}: differs from ${manifest}: re-vendor it, never edit it in the repo`
}

/** The files in the manifest's folder that it does not list (the folder rule). */
function unlistedFindings(root: string, manifest: string, listed: ReadonlySet<string>): string[] {
  return filesUnder(join(root, dirname(manifest)))
    .filter((file) => !listed.has(file))
    .map(
      (file) =>
        `${posix(relative(root, file))}: in ${posix(dirname(manifest))}/ but not in ${manifest}: the manifest's folder holds only the vendored files, so move your own file out of it`,
    )
}

/** One manifest: its findings, and the copies it sanctions into `sanction`. */
function manifestFindings(root: string, manifest: string, sanction: Sanction): string[] {
  const data = readManifest(root, manifest)
  if (typeof data === "string") return [data]
  const findings: string[] = []
  const folder = join(root, dirname(manifest))
  const listed = new Set([join(root, manifest)])
  for (const entry of data.dateien) {
    if (!isRepoRelative(entry.pfad)) {
      findings.push(
        `${manifest}: ${entry.pfad} is not a repo-relative path: name the copy from the repo root, without a ".." segment`,
      )
      continue
    }
    const file = join(root, entry.pfad)
    listed.add(file)
    const finding = copyFinding(manifest, entry, file)
    if (finding !== null) {
      findings.push(finding)
      continue
    }
    // A manifest sanctions tokens only inside its own folder (the docs kit
    // also lists its logos under docs/public/logo/: pinned, not sanctioned).
    if (relative(folder, file).split(sep)[0] !== "..") {
      sanction.files.add(file)
      sanction.byManifest.set(manifest, [...(sanction.byManifest.get(manifest) ?? []), file])
    }
  }
  return [...findings, ...unlistedFindings(root, manifest, listed)]
}

/** The stylesheets under the scan roots that declare a `--cd-*` outside a sanctioned copy. */
function forkFindings(root: string, scanRoots: readonly string[], sanctioned: Set<string>) {
  return scanRoots.flatMap((dir) => {
    if (!existsSync(join(root, dir))) {
      return [
        `${dir}: scan root missing: point the drift guard at the folders that hold stylesheets`,
      ]
    }
    return stylesheetsUnder(root, join(root, dir))
      .filter((file) => !sanctioned.has(file))
      .filter((file) => CD_DECLARATION.test(rulesOf(readFileSync(file, "utf8"))))
      .map(
        (file) =>
          `${posix(relative(root, file))}: declares --cd-* outside a sanctioned vendored copy (a fork): reference pulse-ui's tokens and roles with var(), or vendor the CI file unchanged with a manifest listed in SANCTIONED_TOKEN_MANIFESTS`,
      )
  })
}

const stylesheetsOf = (files: Iterable<string>) =>
  [...files].filter((name) => name.endsWith(".css"))

/** One manifest's copies against pulse-ui's palette: no token dropped. */
function paletteFindings(
  manifest: string,
  files: readonly string[],
  palette: ReadonlyMap<string, string>,
): string[] {
  const declared = new Set<string>()
  let declaresTokens = false
  for (const file of stylesheetsOf(files)) {
    const css = readFileSync(file, "utf8")
    declaresTokens ||= CD_DECLARATION.test(rulesOf(css))
    for (const name of rootTokens(css).keys()) declared.add(name)
  }
  const missing = [...palette.keys()].filter((name) => !declared.has(name))
  return declaresTokens && missing.length > 0
    ? [
        `${manifest}: its vendored stylesheets declare --cd-* tokens, but no top-level :root among them declares ${missing.join(", ")}, which pulse-ui's copy does: a copy without a palette token forks the palette by omission, so vendor the CI token file whole (a re-vendor), never trim it`,
      ]
    : []
}

/**
 * Token equality over every sanctioned copy: each `--cd-*` in each scope has one
 * value, and the palette's in a top-level `:root`. The finding names every value
 * with the copies that say it.
 */
function equalityFindings(
  root: string,
  sanctioned: ReadonlySet<string>,
  palette: ReadonlyMap<string, string>,
): string[] {
  const said = new Map<string, Map<string, string[]>>()
  const say = (token: string, value: string, source: string) => {
    const values = said.get(token) ?? new Map<string, string[]>()
    values.set(value, [...(values.get(value) ?? []), source])
    said.set(token, values)
  }
  for (const [name, value] of palette) say(`${name} in :root`, value, "pulse-ui's palette")
  for (const file of stylesheetsOf(sanctioned)) {
    for (const [scope, tokens] of scopedTokens(readFileSync(file, "utf8"))) {
      for (const [name, value] of tokens)
        say(`${name} in ${scope}`, value, posix(relative(root, file)))
    }
  }
  return [...said]
    .filter(([, values]) => values.size > 1)
    .map(
      ([token, values]) =>
        `${token} differs between the vendored copies (${[...values].map(([value, sources]) => `${value} in ${sources.join(", ")}`).join("; ")}): vendor every copy from the same CI release (a re-vendor), never change a value in the repo`,
    )
}

/**
 * Findings for the vendored token copies, empty when every `--cd-*` in the
 * scanned stylesheets lives in a sanctioned, unedited copy on pulse-ui's
 * palette and every copy gives a token the same value in the same scope. Each
 * finding names the offending path or token and the fix.
 */
export function vendoredTokenFindings({
  root,
  manifests,
  scanRoots,
  palette,
}: VendoredTokenOptions): string[] {
  const sanction: Sanction = { files: new Set(), byManifest: new Map() }
  const findings = manifests.flatMap((manifest) => manifestFindings(root, manifest, sanction))
  findings.push(...forkFindings(root, scanRoots, sanction.files))
  findings.push(...equalityFindings(root, sanction.files, palette))
  for (const [manifest, files] of sanction.byManifest) {
    findings.push(...paletteFindings(manifest, files, palette))
  }
  return findings
}
