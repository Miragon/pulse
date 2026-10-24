import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

/**
 * The verifier behind the token drift guard (`ui-stylesheet.test.ts`;
 * modeler-tool-design §13: vendor the CI tokens unchanged, never fork a
 * value). Besides the toolkit's copy (installed, so never scanned) a `--cd-*`
 * token may be declared only in a vendored copy of a CI file that a SANCTIONED
 * manifest lists. The manifest has the docs kit's format (`version` x.y.z,
 * `dateien: [{ pfad, quelle, sha256 }]`, at least one file; extra keys such as
 * `$kommentar` are fine) and sanctions a stylesheet only when it lies inside
 * the manifest's own folder and matches its sha256 byte for byte. A manifest
 * sanctions nothing by being there: the caller names the manifests it trusts.
 * A sanctioned stylesheet keeps every palette value it declares in a top-level
 * `:root`, and once any stylesheet of a manifest declares a `--cd-*` at all,
 * those stylesheets' top-level `:root` blocks together declare EVERY token of
 * the palette: a copy that drops one forks the palette by omission.
 *
 * Every rule fails closed: a sanctioned manifest that is missing, malformed,
 * lists a path outside the repo, a missing or edited file, or sits next to a
 * file it does not list is a finding, never a skip.
 *
 * This module is a test helper inside the app's measured coverage scope:
 * `vendored-tokens.test.ts` reaches every branch. Keep it that way when you
 * change it.
 */

/** Installs and build output: never repo content (the toolkit's own copy sits in node_modules). */
const SKIPPED = ["node_modules", "dist", "cache", ".vitepress-cache", "test-results"]

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
   * The toolkit copy's top-level `:root` tokens (`rootTokens`): a sanctioned
   * copy keeps each value, and a manifest whose copies declare tokens declares
   * all of them.
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
function stylesheetsUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.includes(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return stylesheetsUnder(path)
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

/**
 * Findings for the vendored token copies, empty when every `--cd-*` in the
 * scanned stylesheets lives in a sanctioned, unedited copy on the toolkit's
 * palette. Each finding names the offending path and the fix.
 */
export function vendoredTokenFindings({
  root,
  manifests,
  scanRoots,
  palette,
}: VendoredTokenOptions): string[] {
  const findings: string[] = []
  const sanctioned = new Set<string>()
  /** The files each manifest sanctions. */
  const sanctionedBy = new Map<string, string[]>()

  for (const manifest of manifests) {
    const data = readManifest(root, manifest)
    if (typeof data === "string") {
      findings.push(data)
      continue
    }
    const folder = join(root, dirname(manifest))
    const listed = new Set([join(root, manifest)])
    for (const { pfad, sha256 } of data.dateien) {
      if (isAbsolute(pfad) || pfad.split(/[\\/]/).includes("..")) {
        findings.push(
          `${manifest}: ${pfad} is not a repo-relative path: name the copy from the repo root, without a ".." segment`,
        )
        continue
      }
      const file = join(root, pfad)
      listed.add(file)
      if (!isFile(file)) {
        findings.push(
          `${pfad}: listed in ${manifest} but missing: re-vendor it from the CI, or regenerate the manifest`,
        )
        continue
      }
      if (sha256Of(file) !== sha256) {
        findings.push(`${pfad}: differs from ${manifest}: re-vendor it, never edit it in the repo`)
        continue
      }
      // A manifest sanctions tokens only inside its own folder (the docs kit
      // also lists its logos under docs/public/logo/: pinned, not sanctioned).
      if (relative(folder, file).split(sep)[0] !== "..") {
        sanctioned.add(file)
        sanctionedBy.set(manifest, [...(sanctionedBy.get(manifest) ?? []), file])
      }
    }
    for (const file of filesUnder(folder)) {
      if (!listed.has(file)) {
        findings.push(
          `${posix(relative(root, file))}: in ${posix(dirname(manifest))}/ but not in ${manifest}: the manifest's folder holds only the vendored files, so move your own file out of it`,
        )
      }
    }
  }

  for (const dir of scanRoots) {
    if (!existsSync(join(root, dir))) {
      findings.push(
        `${dir}: scan root missing: point the drift guard at the folders that hold stylesheets`,
      )
      continue
    }
    for (const file of stylesheetsUnder(join(root, dir))) {
      if (sanctioned.has(file) || !CD_DECLARATION.test(rulesOf(readFileSync(file, "utf8")))) {
        continue
      }
      findings.push(
        `${posix(relative(root, file))}: declares --cd-* outside a sanctioned vendored copy (a fork): reference the toolkit's tokens and roles with var(), or vendor the CI file unchanged with a manifest listed in SANCTIONED_TOKEN_MANIFESTS`,
      )
    }
  }

  for (const [manifest, files] of sanctionedBy) {
    const declared = new Set<string>()
    let declaresTokens = false
    for (const file of files.filter((name) => name.endsWith(".css"))) {
      const css = readFileSync(file, "utf8")
      declaresTokens ||= CD_DECLARATION.test(rulesOf(css))
      for (const [name, value] of rootTokens(css)) {
        declared.add(name)
        const expected = palette.get(name)
        if (expected !== undefined && expected !== value) {
          findings.push(
            `${posix(relative(root, file))}: ${name} is ${value}, the toolkit's copy says ${expected}: vendor both from the same CI release (a toolkit bump or a re-vendor), never change a value in the repo`,
          )
        }
      }
    }
    const missing = [...palette.keys()].filter((name) => !declared.has(name))
    if (declaresTokens && missing.length > 0) {
      findings.push(
        `${manifest}: its vendored stylesheets declare --cd-* tokens, but no top-level :root among them declares ${missing.join(", ")}, which the toolkit's copy does: a copy without a palette token forks the palette by omission, so vendor the CI token file whole (a toolkit bump or a re-vendor), never trim it`,
      )
    }
  }

  return findings
}
