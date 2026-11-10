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
 * the manifest's own folder and matches its sha256 byte for byte. A sanctioned
 * entry ending in `.sha256` is a sha256sum list instead, as `brand-assets.mjs`
 * writes `.miragon/brand-assets.sha256`: it sanctions each copy it lists in
 * that copy's folder, and each such folder holds only listed copies. A manifest
 * sanctions nothing by being there: the caller names the manifests it trusts.
 * A sanctioned stylesheet keeps every palette value it declares in a top-level
 * `:root`, and once any stylesheet of a manifest (or of one folder of a
 * sha256sum list) declares a `--cd-*` at all, those stylesheets' top-level
 * `:root` blocks together declare EVERY token of the palette: a copy that drops
 * one forks the palette by omission. A manifest the caller names in
 * `valuesOnly` is held to the values it declares, not to the whole palette.
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
const CHECKSUM_LINE = /^([0-9a-f]{64}) {2}(.+)$/
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

/** A copy as a sha256sum list names it: no `quelle`. */
type ListedCopy = Pick<VendoredFile, "pfad" | "sha256">

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
   * copy keeps each value, and a manifest whose copies declare tokens declares
   * all of them.
   */
  palette: ReadonlyMap<string, string>
  /** Sanctioned manifests whose copies may declare fewer tokens than the palette (an older release). */
  valuesOnly?: readonly string[]
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

/** The copies of a sha256sum list (`<sha256>  <path>` per line), or the finding that says why it cannot be trusted. */
function readChecksums(root: string, checksums: string): ListedCopy[] | string {
  let text: string
  try {
    text = readFileSync(join(root, checksums), "utf8")
  } catch (error) {
    return `${checksums}: missing (${String(error)}): copy the brand assets again with brand-assets.mjs, or remove the entry in SANCTIONED_TOKEN_MANIFESTS`
  }
  const lines = text.split("\n").filter((line) => line !== "")
  const copies = lines.flatMap((line) => {
    const match = CHECKSUM_LINE.exec(line)
    return match ? [{ sha256: match[1], pfad: match[2] }] : []
  })
  return copies.length > 0 && copies.length === lines.length
    ? copies
    : `${checksums}: not a sha256sum list (one "<sha256>  <path>" per line, at least one): let brand-assets.mjs write it`
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

/** What the manifests sanction: the copies inside their folders, by manifest. */
interface Sanction {
  /** Every sanctioned copy (absolute path). */
  files: Set<string>
  /** The copies each manifest sanctions. */
  byManifest: Map<string, string[]>
}

const isRepoRelative = (pfad: string) => !isAbsolute(pfad) && !pfad.split(/[\\/]/).includes("..")

/** The finding for a listed copy that is missing or edited, else none. */
function copyFinding(manifest: string, { pfad, sha256 }: ListedCopy, file: string) {
  if (!isFile(file)) {
    return `${pfad}: listed in ${manifest} but missing: re-vendor it from the CI, or regenerate the manifest`
  }
  return sha256Of(file) === sha256
    ? null
    : `${pfad}: differs from ${manifest}: re-vendor it, never edit it in the repo`
}

/** Copies listed together: what lists them, the folder they are sanctioned in, and the key their palette is held by. */
interface CopyGroup {
  /** The manifest or sha256sum list, repo-relative. */
  lister: string
  /** Repo-relative folder that holds only listed files. */
  folder: string
  /** The key the group's copies are held to the palette by. */
  paletteKey: string
  copies: readonly ListedCopy[]
  /** The files in the folder that belong there without being copies (the manifest itself). */
  alsoListed: readonly string[]
}

const notRepoRelative = (lister: string, pfad: string) =>
  `${lister}: ${pfad} is not a repo-relative path: name the copy from the repo root, without a ".." segment`

/** The files in the group's folder that it does not list (the folder rule). */
function unlistedFindings(
  root: string,
  { lister, folder }: CopyGroup,
  listed: ReadonlySet<string>,
) {
  return filesUnder(join(root, folder))
    .filter((file) => !listed.has(file))
    .map(
      (file) =>
        `${posix(relative(root, file))}: in ${posix(folder)}/ but not in ${lister}: the manifest's folder holds only the vendored files, so move your own file out of it`,
    )
}

/** One group of copies: its findings, and the copies it sanctions into `sanction`. */
function groupFindings(root: string, group: CopyGroup, sanction: Sanction): string[] {
  const findings: string[] = []
  const folder = join(root, group.folder)
  const listed = new Set(group.alsoListed.map((file) => join(root, file)))
  for (const entry of group.copies) {
    if (!isRepoRelative(entry.pfad)) {
      findings.push(notRepoRelative(group.lister, entry.pfad))
      continue
    }
    const file = join(root, entry.pfad)
    listed.add(file)
    const finding = copyFinding(group.lister, entry, file)
    if (finding !== null) {
      findings.push(finding)
      continue
    }
    // A manifest sanctions tokens only inside its own folder (the docs kit
    // also lists its logos under docs/public/logo/: pinned, not sanctioned).
    if (relative(folder, file).split(sep)[0] !== "..") {
      sanction.files.add(file)
      const sanctioned = sanction.byManifest.get(group.paletteKey) ?? []
      sanction.byManifest.set(group.paletteKey, [...sanctioned, file])
    }
  }
  return [...findings, ...unlistedFindings(root, group, listed)]
}

/** One manifest: its findings, and the copies it sanctions into `sanction`. */
function manifestFindings(root: string, manifest: string, sanction: Sanction): string[] {
  const data = readManifest(root, manifest)
  if (typeof data === "string") return [data]
  const group = {
    lister: manifest,
    folder: dirname(manifest),
    paletteKey: manifest,
    copies: data.dateien,
    alsoListed: [manifest],
  }
  return groupFindings(root, group, sanction)
}

/** One sha256sum list: each folder of its copies is a group of its own. */
function checksumFindings(root: string, checksums: string, sanction: Sanction): string[] {
  const copies = readChecksums(root, checksums)
  if (typeof copies === "string") return [copies]
  const findings = copies
    .filter(({ pfad }) => !isRepoRelative(pfad))
    .map(({ pfad }) => notRepoRelative(checksums, pfad))
  const byFolder = new Map<string, ListedCopy[]>()
  for (const copy of copies.filter(({ pfad }) => isRepoRelative(pfad))) {
    byFolder.set(dirname(copy.pfad), [...(byFolder.get(dirname(copy.pfad)) ?? []), copy])
  }
  for (const [folder, inFolder] of byFolder) {
    const group = {
      lister: checksums,
      folder,
      paletteKey: `${checksums} (${posix(folder)}/)`,
      copies: inFolder,
      alsoListed: [],
    }
    findings.push(...groupFindings(root, group, sanction))
  }
  return findings
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

/** One manifest's copies against pulse-ui's palette: each value kept, and no token dropped. */
function paletteFindings(
  root: string,
  manifest: string,
  files: readonly string[],
  palette: ReadonlyMap<string, string>,
  wholePalette: boolean,
): string[] {
  const findings: string[] = []
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
          `${posix(relative(root, file))}: ${name} is ${value}, pulse-ui's copy says ${expected}: vendor both from the same CI release (a re-vendor), never change a value in the repo`,
        )
      }
    }
  }
  const missing = [...palette.keys()].filter((name) => !declared.has(name))
  if (wholePalette && declaresTokens && missing.length > 0) {
    findings.push(
      `${manifest}: its vendored stylesheets declare --cd-* tokens, but no top-level :root among them declares ${missing.join(", ")}, which pulse-ui's copy does: a copy without a palette token forks the palette by omission, so vendor the CI token file whole (a re-vendor), never trim it`,
    )
  }
  return findings
}

/**
 * Findings for the vendored token copies, empty when every `--cd-*` in the
 * scanned stylesheets lives in a sanctioned, unedited copy on pulse-ui's
 * palette. Each finding names the offending path and the fix.
 */
export function vendoredTokenFindings({
  root,
  manifests,
  scanRoots,
  palette,
  valuesOnly = [],
}: VendoredTokenOptions): string[] {
  const sanction: Sanction = { files: new Set(), byManifest: new Map() }
  const findings = manifests.flatMap((manifest) =>
    manifest.endsWith(".sha256")
      ? checksumFindings(root, manifest, sanction)
      : manifestFindings(root, manifest, sanction),
  )
  findings.push(...forkFindings(root, scanRoots, sanction.files))
  for (const [manifest, files] of sanction.byManifest) {
    findings.push(
      ...paletteFindings(root, manifest, files, palette, !valuesOnly.includes(manifest)),
    )
  }
  return findings
}
