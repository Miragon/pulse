/**
 * What the CLI's bundles hold of works that are not the CLI's own (apps/cli/CLAUDE.md,
 * "Licences"): every module of a bundle's module graph mapped onto where it comes from. A module
 * under node_modules belongs to the package whose directory holds it, a virtual module of the
 * bundler to the package that writes it (`Layout.virtual`), and a file of this repository to the
 * CLI, the repository or one of Pulse's own packages, which share the CLI's licence; a module of
 * the CLI that carries the text of another work names that work in `Layout.embedded`. Anything
 * else fails, and so does a work without a licence file, so nothing reaches a bundle unlisted.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

/** The CLI's two bundles: the npm package's and the standalone one of the image and executables. */
const BUNDLE_NAMES = ["npm", "standalone"] as const
export type BundleName = (typeof BUNDLE_NAMES)[number]

/** A licence or notice file of a work, by its file name, its text with LF line ends. */
export interface LicenceText {
  readonly file: string
  readonly text: string
}

/** A work of someone else that a bundle holds, with the files its licence asks to ship along. */
export interface ThirdParty {
  readonly name: string
  readonly version: string
  /** Its licence as an SPDX expression. */
  readonly licence: string
  readonly source: string | undefined
  /** What of it the bundles hold, where that is not simply its code. */
  readonly holds: string | undefined
  readonly texts: readonly LicenceText[]
  readonly bundles: readonly BundleName[]
}

type Work = Omit<ThirdParty, "bundles">

export interface Inventory {
  /** Sorted by name, case aside. */
  readonly thirdParty: readonly ThirdParty[]
  /** Pulse's own packages the bundles hold, under the CLI's licence. */
  readonly own: readonly string[]
  /** The npm package's dependencies as `<name> <version>`: npm installs each with its licence. */
  readonly installed: readonly string[]
}

/** A work whose text a module of the CLI carries: its OpenAPI document beside its licence files. */
interface EmbeddedSource {
  readonly dir: string
  /** The OpenAPI document in `dir` whose `info` names the work, its version and its licence. */
  readonly spec: string
  /** The licence as an SPDX id, and as the document's `info.license.name` spells it. */
  readonly licence: string
  readonly licenceName: string
  readonly holds: string
  readonly source: string
}

/** Where the inventory looks; real paths, as the bundler reports its modules. */
export interface Layout {
  readonly repo: string
  readonly cli: string
  /** A virtual module of the bundler, by its id: the directory of the package that writes it. */
  readonly virtual: Readonly<Record<string, { readonly dir: string; readonly holds: string }>>
  /** A module of the CLI that carries another work's text, by its path in the CLI. */
  readonly embedded: Readonly<Record<string, EmbeddedSource>>
}

type Origin =
  | { readonly kind: "own"; readonly packageDir?: string }
  | { readonly kind: "third-party"; readonly dir: string; readonly holds?: string }

interface Manifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly license?: unknown
  readonly repository?: unknown
  readonly homepage?: unknown
  readonly dependencies?: Readonly<Record<string, string>>
}

/** The files a work ships its licence and notices in; code of such a name (`license.js`) is none. */
const LICENCE_FILE =
  /^(?:licen[cs]es?|copying|notices?|third[-_]party[-_](?:licen[cs]es?|notices?))(?:[.-].*)?$/i
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json|map)$/i
const NODE_MODULES = `${sep}node_modules${sep}`

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest

function field(manifest: Manifest, key: "name" | "version" | "license", dir: string): string {
  const value = manifest[key]
  if (typeof value !== "string" || value === "") {
    throw new Error(`${join(dir, "package.json")} names no ${key}: the licence list needs it`)
  }
  return value
}

/** The repository URL a manifest names, without git's decorations. */
function sourceOf(manifest: Manifest): string | undefined {
  const { repository, homepage } = manifest
  const url =
    typeof repository === "string"
      ? repository
      : ((repository as { url?: unknown } | undefined)?.url ?? homepage)
  return typeof url === "string" ? url.replace(/^git\+/, "").replace(/\.git$/, "") : undefined
}

/** A text as the list holds it: LF line ends, no trailing blanks, no blank lines around it. */
const normalized = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "")

/**
 * The licence and notice files of a work's directory; a work without one fails, and so does one
 * that keeps them in a folder (REUSE's `LICENSES/`), which the list does not read.
 */
export function licenceTexts(dir: string, work: string): LicenceText[] {
  const files = readdirSync(dir)
    .filter((file) => LICENCE_FILE.test(file) && !CODE_FILE.test(file))
    .sort()
  const folders = files.filter((file) => statSync(join(dir, file)).isDirectory())
  if (folders.length > 0) {
    throw new Error(
      `${work} (${dir}) keeps licence texts in the folder ${folders.join(", ")}: read them, and ` +
        "teach scripts/licenses/inventory.ts to list them",
    )
  }
  if (files.length === 0) {
    throw new Error(
      `${work} (${dir}) ships no licence file (LICENSE, LICENCE, COPYING, NOTICE): find its ` +
        "licence before it ships, and teach scripts/licenses/inventory.ts where it is",
    )
  }
  return files.map((file) => ({ file, text: normalized(readFileSync(join(dir, file), "utf8")) }))
}

/** The directory of the package a path under node_modules lies in (the last node_modules). */
function packageDirOf(path: string, at: number): string {
  const [first = "", second = ""] = path.slice(at + NODE_MODULES.length).split(sep)
  return join(path.slice(0, at + NODE_MODULES.length), first, first.startsWith("@") ? second : "")
}

const isWithin = (dir: string, path: string): boolean => {
  const rel = relative(dir, path)
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep)
}

/** A file of the repository: the CLI's, the repository's or one of Pulse's own packages'. */
function ownOrigin(path: string, layout: Layout): Origin {
  let dir = dirname(path)
  while (dir !== layout.repo && !existsSync(join(dir, "package.json"))) dir = dirname(dir)
  return dir === layout.repo || dir === layout.cli
    ? { kind: "own" }
    : { kind: "own", packageDir: dir }
}

/** Where a module of a bundle's module graph comes from. */
export function originOf(id: string, layout: Layout): Origin {
  if (id.startsWith("\0")) {
    const virtual = layout.virtual[id]
    if (virtual === undefined) {
      throw new Error(
        `the bundle holds the virtual module ${JSON.stringify(id)}: name the package that ` +
          "writes it in the layout's virtual modules (scripts/licenses/bundles.ts)",
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

/** A package under node_modules, or the bundler behind a virtual module. */
function packageWork(dir: string, holds: string | undefined): Work {
  const manifest = readManifest(dir)
  const name = field(manifest, "name", dir)
  const version = field(manifest, "version", dir)
  const work = `${name} ${version}`
  const texts = licenceTexts(dir, work)
  return {
    name,
    version,
    licence: field(manifest, "license", dir),
    source: sourceOf(manifest),
    holds,
    texts,
  }
}

/** The work a module of the CLI carries the text of, named by its OpenAPI document. */
function embeddedWork(source: EmbeddedSource): Work {
  const { info } = JSON.parse(readFileSync(join(source.dir, source.spec), "utf8")) as {
    info: { title: string; version: string; license?: { name?: string } }
  }
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

/** The name of one of Pulse's packages in a bundle, which must be under the CLI's licence. */
function ownPackage(dir: string, licence: string): string {
  const manifest = readManifest(dir)
  const name = field(manifest, "name", dir)
  const theirs = field(manifest, "license", dir)
  if (theirs !== licence) {
    throw new Error(
      `${name} is under ${theirs}, not the CLI's ${licence}: list it as a third party`,
    )
  }
  return name
}

/** A module's path in the CLI, with forward slashes, as `Layout.embedded` keys it. */
const cliPath = (id: string, layout: Layout): string =>
  relative(layout.cli, realpathSync(id)).split(sep).join("/")

/** The works and Pulse packages the modules come from, each work once per name and version. */
class Works {
  readonly thirdParty = new Map<string, { work: Work; bundles: Set<BundleName> }>()
  readonly own = new Set<string>()
  private readonly byDir = new Map<string, Work>()

  constructor(
    private readonly layout: Layout,
    private readonly licence: string,
  ) {}

  private add(dir: string, bundle: BundleName, read: () => Work): void {
    const work = this.byDir.get(dir) ?? read()
    this.byDir.set(dir, work)
    const key = `${work.name} ${work.version}`
    const entry = this.thirdParty.get(key) ?? { work, bundles: new Set<BundleName>() }
    entry.bundles.add(bundle)
    this.thirdParty.set(key, entry)
  }

  addModule(id: string, bundle: BundleName): void {
    const origin = originOf(id, this.layout)
    if (origin.kind === "third-party") {
      this.add(origin.dir, bundle, () => packageWork(origin.dir, origin.holds))
    } else if (origin.packageDir !== undefined) {
      this.own.add(ownPackage(origin.packageDir, this.licence))
    }
    const embedded = id.startsWith("\0")
      ? undefined
      : this.layout.embedded[cliPath(id, this.layout)]
    if (embedded !== undefined) this.add(embedded.dir, bundle, () => embeddedWork(embedded))
  }
}

const byName = (a: ThirdParty, b: ThirdParty): number => {
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()]
  return x < y ? -1 : x > y ? 1 : 0
}

/** The inventory of the bundles' module graphs (module ids per bundle, as the bundler names them). */
export function inventoryOf(
  modules: Readonly<Record<BundleName, readonly string[]>>,
  layout: Layout,
): Inventory {
  const cli = readManifest(layout.cli)
  const works = new Works(layout, field(cli, "license", layout.cli))
  for (const bundle of BUNDLE_NAMES) {
    for (const id of modules[bundle]) works.addModule(id, bundle)
  }
  const thirdParty = [...works.thirdParty.values()]
    .map(({ work, bundles }) => ({ ...work, bundles: BUNDLE_NAMES.filter((b) => bundles.has(b)) }))
    .sort(byName)
  const installed = Object.entries(cli.dependencies ?? {}).map(
    ([name, version]) => `${name} ${version}`,
  )
  return { thirdParty, own: [...works.own].toSorted(), installed: installed.toSorted() }
}
